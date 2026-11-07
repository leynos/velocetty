#!/usr/bin/env bash
# Verifies LemmaScript contracts and refuses vacuous success.
#
# The guards matter as much as the verifier: `lsc` exits 0 for an empty file
# list, silently downgrades entries with long timeouts to generation checks, and
# treats `extern` calls as axioms. Each guard below closes one of those
# loopholes so a green `make prove` means the policy proof actually ran.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

readonly list_file='LemmaScript-files.txt'
readonly max_timeout_seconds=60
readonly policy_source='app/config/keybindings-policy.ts'
readonly expected_dafny_prefix='4.11.'
readonly lsc_bin='node_modules/.bin/lsc'
# The one admitted axiom, matched exactly so a forbidden construct cannot hide
# on a line that merely mentions this function.
readonly trusted_axiom_line='function {:axiom} emptyUserKeymaps(): UserKeymaps'
# Dafny accepts whitespace around an attribute's colon and name, so the axiom
# pattern must too; otherwise `{:axiom }` would slip past the guard.
# Braces are written as `[{]`/`[}]` so the same pattern is valid in both
# `grep -E` and `awk`, which disagree about escaping a literal brace.
readonly trust_pattern='(^|[^[:alnum:]_])(assume)([^[:alnum:]_]|$)|[{][[:space:]]*:[[:space:]]*verify[[:space:]]+false[[:space:]]*[}]|[{][[:space:]]*:[[:space:]]*axiom[[:space:]]*[}]'

fail() {
  printf 'prove: %s\n' "$*" >&2
  exit 1
}

# Pin the local install. A bare `bunx lsc` without `node_modules` resolves the
# published npm package literally named `lsc`, which is a different tool that
# fails with "Command not found!".
require_lsc() {
  [[ -x "$lsc_bin" ]] ||
    fail "Missing ${lsc_bin}. Run 'bun install' first; without it a bare 'bunx lsc' runs an unrelated npm package."
}

require_dafny() {
  if ! command -v dafny >/dev/null 2>&1; then
    fail "Dafny is not installed. Install Dafny ${expected_dafny_prefix}0 from https://github.com/dafny-lang/dafny/releases."
  fi

  local version
  version="$(dafny --version 2>/dev/null || true)"
  if [[ "$version" != "$expected_dafny_prefix"* ]]; then
    fail "Expected Dafny ${expected_dafny_prefix}x, found '${version:-unknown}'. Install Dafny ${expected_dafny_prefix}0."
  fi
}

# The dotnet tool installs no solver. On a clean runner the first source fails
# with "Z3 is not found", which reads like a broken proof rather than a missing
# dependency, so say what is actually wrong before starting.
#
# `dafny` is often a dotnet-tool shim symlinked onto PATH, and Dafny looks for
# its solver beside the real executable rather than beside the symlink, so the
# check resolves the link first.
require_solver() {
  local dafny_bin dafny_dir
  dafny_bin="$(command -v dafny)"
  if ! dafny_dir="$(dirname "$(readlink -f "$dafny_bin")")"; then
    dafny_dir="$(dirname "$dafny_bin")"
  fi
  if command -v z3 >/dev/null 2>&1 || [[ -x "${dafny_dir}/z3/bin/z3-4.12.1" ]]; then
    return
  fi
  fail "Z3 4.12.1 is not beside '${dafny_dir}' or on PATH. Install it where Dafny looks: ${dafny_dir}/z3/bin/z3-4.12.1."
}

read_entries() {
  [[ -f "$list_file" ]] || fail "Missing ${list_file}."

  local line
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    printf '%s\n' "$line"
  done <"$list_file"
}

validate_entries() {
  local entry source timeout extra
  local -a sources=()

  while IFS= read -r entry; do
    read -r source timeout extra <<<"$entry"
    [[ -f "$source" ]] || fail "Listed proof source '${source}' does not exist."
    # The list has two columns. Silently ignoring a third would let a typo or a
    # copied timeout pass as configuration the script does not implement.
    [[ -z "${extra:-}" ]] || fail "Unexpected text '${extra}' after the timeout for '${source}'."
    if [[ -n "${timeout:-}" ]]; then
      [[ "$timeout" =~ ^[0-9]+$ ]] || fail "Timeout '${timeout}' for '${source}' is not an integer."
      ((timeout <= max_timeout_seconds)) ||
        fail "Timeout ${timeout}s for '${source}' exceeds the ${max_timeout_seconds}s limit; lsc would silently downgrade it to a generation check."
    fi
    sources+=("$source")
  done < <(read_entries)

  ((${#sources[@]} > 0)) || fail "${list_file} lists no proof sources; an empty batch verifies nothing."

  if [[ -f "$policy_source" ]] && ! printf '%s\n' "${sources[@]}" | grep -Fxq "$policy_source"; then
    fail "${policy_source} exists but is not listed in ${list_file}, so the policy proof would not run."
  fi
}

check_generated_artefacts_are_current() {
  local source generated
  while IFS= read -r source; do
    read -r source _ <<<"$source"
    generated="${source%.ts}.dfy.gen"
    [[ -f "$generated" ]] || fail "Missing generated proof artefact '${generated}'. Run 'bun bin/generate-dafny.mjs'."
  done < <(read_entries)

  # The wrapper runs `lsc gen` and then prepends the module header, so the
  # comparison below is against the artefact the project actually ships.
  bun bin/generate-dafny.mjs >/dev/null
  if ! git diff --quiet -- '*.dfy.gen'; then
    fail "Generated Dafny artefacts are stale. Commit the regenerated *.dfy.gen files."
  fi
}

# Prints the forbidden constructs in one proof file, as `file:line:content`.
#
# A generated artefact starts with a header copied from its TypeScript module's
# `@file` summary. That summary is prose and may legitimately use a word the
# scan forbids, so the header is skipped; the proof body is still checked.
scan_for_trust_constructs() {
  local file="$1"
  if [[ "$file" != *.dfy.gen ]]; then
    # `-H` keeps the `file:line:content` shape the caller strips, even though
    # only one file is searched.
    grep -HnE "$trust_pattern" "$file" || true
    return
  fi
  awk -v pattern="$trust_pattern" '
    FNR == 1 && /^\/\/ -+$/ {in_header = 1; next}
    in_header && /^\/\/ -+$/ {in_header = 0; next}
    in_header {next}
    $0 ~ pattern {printf "%s:%d:%s\n", FILENAME, FNR, $0}
  ' "$file"
}

# Prints the hand-authored and generated Dafny file of every listed source.
#
# The list is authoritative: a proof may live outside `app/config`, and deriving
# the scan targets from it means a listed proof cannot be verified while
# escaping the trust-construct scan.
list_proof_artefacts() {
  local entry source base candidate
  while IFS= read -r entry; do
    read -r source _ <<<"$entry"
    base="${source%.ts}"
    for candidate in "${base}.dfy" "${base}.dfy.gen"; do
      if [[ -f "$candidate" ]]; then
        printf '%s\n' "$candidate"
      fi
    done
  done < <(read_entries)
}

check_forbidden_trust_constructs() {
  # A `while read` loop rather than `mapfile`, which is a bash 4 builtin:
  # macOS still ships bash 3.2, and this guard must run there too.
  local matches='' file found
  while IFS= read -r file; do
    found="$(scan_for_trust_constructs "$file")"
    if [[ -n "$found" ]]; then
      matches+="$found"$'\n'
    fi
  done < <(list_proof_artefacts)
  if [[ -n "$matches" ]]; then
    # `emptyUserKeymaps` is the single admitted axiom; every other trust
    # construct makes the proof vacuous.
    local offending
    offending="$(printf '%s\n' "$matches" | sed -E 's/^[^:]+:[0-9]+://' | grep -vxF "$trusted_axiom_line" || true)"
    if [[ -n "$offending" ]]; then
      printf '%s\n' "$offending" >&2
      fail "Forbidden Dafny trust construct found; only emptyUserKeymaps may be an axiom."
    fi
  fi
}

run_verification() {
  local output verified summaries expected
  if ! output="$("$lsc_bin" check --backend=dafny 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail "LemmaScript verification failed."
  fi
  printf '%s\n' "$output"

  verified="$(printf '%s\n' "$output" |
    grep -oE 'Dafny program verifier finished with [0-9]+ verified, 0 errors' |
    tail -n 1 |
    grep -oE '[0-9]+' |
    head -n 1 || true)"
  [[ -n "$verified" ]] || fail "The verifier output did not report 'Dafny program verifier finished with <N> verified, 0 errors'."
  ((verified >= 1)) || fail "The verifier reported zero verified programs."

  # Every listed source must report a positive summary. A combined or cached
  # run that prints one summary for several sources would otherwise pass.
  summaries="$(printf '%s\n' "$output" |
    grep -cE 'Dafny program verifier finished with [0-9]+ verified, 0 errors' || true)"
  expected="$(read_entries | wc -l)"
  ((summaries >= expected)) ||
    fail "Only ${summaries} verifier summaries for ${expected} listed sources; not every proof ran."
}

# `lsc check` rewrites each `.dfy.gen` without the module header the shipped
# artefact carries. Regenerate through the wrapper afterwards, so a green run
# leaves the worktree as it found it and the next diff stays meaningful.
restore_generated_artefacts() {
  bun bin/generate-dafny.mjs >/dev/null
  if ! git diff --quiet -- '*.dfy.gen'; then
    fail "Regenerated proof artefacts differ from the committed ones after verification."
  fi
}

main() {
  require_dafny
  require_solver
  require_lsc
  validate_entries
  check_generated_artefacts_are_current
  check_forbidden_trust_constructs
  run_verification
  restore_generated_artefacts
}

main "$@"