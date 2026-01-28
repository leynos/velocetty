.PHONY: all check-fmt typecheck lint test clean nixie

all: check-fmt typecheck lint test

check-fmt:
	bun node_modules/@biomejs/biome/bin/biome check --linter-enabled=false --assist-enabled=false .

typecheck:
	bun node_modules/.bin/tsgo --project tsconfig.typecheck.json

lint:
	bun run lint

test:
	bun run test

clean:
	bun run clean

nixie:
	# CI currently requires --no-sandbox; remove once nixie supports
	# environment variable control for this option
	nixie --no-sandbox
