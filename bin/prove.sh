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
    [[ -f "$generated" ]] || fail "Missing generated proof artefact '${generated}'. Run '${lsc_bin} gen --backend=dafny ${source}'."
  done < <(read_entries)

  "$lsc_bin" gen --backend=dafny >/dev/null
  if ! git diff --quiet -- '*.dfy.gen'; then
    fail "Generated Dafny artefacts are stale. Commit the regenerated *.dfy.gen files."
  fi
}

check_forbidden_trust_constructs() {
  local -a dafny_files=()
  mapfile -t dafny_files < <(find app/config test/proofs -type f \( -name '*.dfy' -o -name '*.dfy.gen' \) -print)
  ((${#dafny_files[@]} > 0)) || return 0

  local matches
  # Dafny accepts whitespace around an attribute's colon and name, so the
  # axiom pattern must too; otherwise `{:axiom }` would slip past the guard.
  matches="$(grep -nE '(^|[^[:alnum:]_])(assume)([^[:alnum:]_]|$)|\{[[:space:]]*:[[:space:]]*verify[[:space:]]+false[[:space:]]*\}|\{[[:space:]]*:[[:space:]]*axiom[[:space:]]*\}' "${dafny_files[@]}" || true)"
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
    head -n 1)"
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

main() {
  require_dafny
  require_solver
  require_lsc
  validate_entries
  check_generated_artefacts_are_current
  check_forbidden_trust_constructs
  run_verification
}

main "$@"