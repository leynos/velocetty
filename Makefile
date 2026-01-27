.PHONY: all check-fmt typecheck lint test clean

all: check-fmt lint test

check-fmt:
	node node_modules/@biomejs/biome/bin/biome check --linter-enabled=false --assist-enabled=false .

typecheck:
	@echo "Typecheck not configured for this repository."

lint:
	bun run lint

test:
	bun run test

clean:
	bun run clean
