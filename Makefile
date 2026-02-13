.PHONY: all check-fmt typecheck lint test coverage build build-fast clean markdownlint nixie

MDLINT ?= markdownlint-cli2
XARGS_R := $(shell if xargs --help 2>&1 | grep -q '\\-r'; then printf -- '-r'; fi)

all: check-fmt typecheck lint test

check-fmt:
	bun node_modules/@biomejs/biome/bin/biome check --linter-enabled=false --assist-enabled=false .

typecheck:
	bun run check:types

lint:
	bun run lint
	@if command -v actionlint >/dev/null 2>&1; then actionlint; else echo "actionlint not installed; skipping"; fi

test:
	bun test --max-concurrency=1
	bun run test:unit:bootstrap-transport

coverage:
	bun run test:coverage

build:
	bun run build && bun bin/run-electron-builder.cjs

build-fast:
	bun run build && bun bin/run-electron-builder.cjs --dir

clean:
	bun run clean

markdownlint: # Lint Markdown files
	find . -type f -name '*.md' -not -path '*/target/*' -not -path '*/node_modules/*' -print0 | xargs -0 $(XARGS_R) $(MDLINT)

nixie:
	# CI currently requires --no-sandbox; remove once nixie supports
	# environment variable control for this option
	nixie --no-sandbox
