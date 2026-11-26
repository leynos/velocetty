.PHONY: all fmt check-fmt typecheck lint test coverage build build-fast \
	clean markdownlint nixie spelling prove proofs proofs-fresh

MDLINT ?= markdownlint-cli2
# `make fmt` and `make check-fmt` call mdtablefix directly. `--git` selects the
# Markdown files Git tracks and `--include-untracked` adds the untracked files
# Git does not ignore, so a new document is formatted before it is staged.
# Both modes need mdtablefix 0.6.0 or later; CI pins the version at the
# install-mdtablefix step.
MDTABLEFIX ?= mdtablefix
MDTABLEFIX_SELECT = --git --include-untracked
MDTABLEFIX_RULES = --wrap --renumber --breaks --ellipsis --fences
XARGS_R := $(shell if xargs --help 2>&1 | grep -q '\\-r'; then printf -- '-r'; fi)
UV ?= uv
UV_ENV = UV_CACHE_DIR=.uv-cache UV_TOOL_DIR=.uv-tools
TYPOS_CONFIG_BUILDER_VERSION ?= v0.1.3
TYPOS_CONFIG_BUILDER = $(UV_ENV) $(UV) tool run --python 3.14 --from \
	"git+https://github.com/leynos/typos-config-builder.git@$(TYPOS_CONFIG_BUILDER_VERSION)" \
	typos-config-builder
# One annotated TypeScript file per line, optionally followed by a Dafny
# timeout and extra flags. Comments (#) and blank lines are ignored.
PROOF_LIST ?= LemmaScript-files.txt
PROOF_FILES = $(shell sed -e 's/\#.*//' -e 's/^[[:space:]]*//' \
	-e 's/[[:space:]].*$$//' -e '/^$$/d' $(PROOF_LIST) 2>/dev/null)

all: check-fmt typecheck lint test spelling prove

fmt:
	bun run fmt
	$(MDTABLEFIX) --in-place $(MDTABLEFIX_SELECT) $(MDTABLEFIX_RULES)
	$(MDLINT) --fix "**/*.md"

check-fmt:
	bun node_modules/@biomejs/biome/bin/biome check --linter-enabled=false --assist-enabled=false .
	$(MDTABLEFIX) --check $(MDTABLEFIX_SELECT) $(MDTABLEFIX_RULES)

typecheck:
	bun run check:types

lint: proofs-fresh
	bun run lint
	@if command -v actionlint >/dev/null 2>&1; then actionlint; else echo "actionlint not installed; skipping"; fi

test:
	bun run test:unit:run

# `proofs-fresh` and `prove` both regenerate every `.dfy.gen` file, so under
# `make -j` they would rewrite each other's inputs. A shared prerequisite makes
# make run the freshness check once, before either consumer; unrelated targets
# still run in parallel. `.NOTPARALLEL` cannot express this: given these two
# targets as prerequisites, GNU make serializes only *their* prerequisites.
prove: proofs-fresh
	./bin/prove.sh

coverage:
	bun run test:coverage

build:
	bun run build && bun bin/run-electron-builder.mjs

build-fast:
	bun run build && bun bin/run-electron-builder.mjs --dir

clean:
	bun run clean

markdownlint: spelling # Lint Markdown files and enforce spelling
	find . -type f -name '*.md' -not -path '*/target/*' -not -path '*/node_modules/*' -print0 | xargs -0 $(XARGS_R) $(MDLINT)

spelling: # Enforce en-GB-oxendict spelling and shared phrase corrections
	$(TYPOS_CONFIG_BUILDER) gate --repository .

nixie:
	# CI currently requires --no-sandbox; remove once nixie supports
	# environment variable control for this option
	nixie --no-sandbox

proofs: prove # Alias for `prove`, kept for the ExecPlan's documented commands

proofs-fresh: # Reject a hand-edited or stale generated Dafny artefact
	bun scripts/check-proof-freshness.mjs
