# Developers guide

This guide captures the development practices specific to the Velocetty
repository. It is intentionally concise and focused on the steps developers
must follow locally.

## Tooling expectations

- Use Bun for JavaScript and TypeScript scripts.
- Prefer Makefile targets for validation commands.
- Keep documentation wrapped to 80 columns and code blocks to 120 columns.

## Formatting and linting

Run the standard gates before opening a pull request:

- `make check-fmt`
- `make lint`

When you change documentation, also run:

- `bunx markdownlint-cli "docs/**/*.md"`
- `nixie --no-sandbox`

## Tests

### Unit tests (Bun)

Unit tests run under Bun's built-in test runner. Use one of the following:

- `bun run test:unit`
- `bun test test/unit`

### End-to-end tests (Playwright)

End-to-end tests are opt-in. They run Playwright against packaged binaries
and require the `dist/` output created by the packaging pipeline.

- Build the app (for example, `bun run dist`).
- Run E2E tests with `bun run test:e2e`.

The E2E tests are skipped unless `RUN_E2E=1` is set. The script
`bun run test:e2e` sets this for you.

By default, E2E runs Playwright locally and a spawn-based smoke check in
CI. Override the driver with `E2E_DRIVER=playwright` or
`E2E_DRIVER=spawn`. Debug logging is opt-in with `E2E_DEBUG=1`, and
`E2E_CAPTURE=1` captures a screenshot from the Electron app.

Diagram: end-to-end test flow showing the prepare step, driver selection,
and the Playwright versus spawn execution paths.

```mermaid
flowchart TB
    Dev[Developer]

    subgraph LocalCommands[Local Test Commands]
        LintCmd["bun run lint"]
        UnitCmd["bun run test:unit"]
        E2ECmd["bun run test:e2e"]
    end

    subgraph BunUnitRunner[Bun Unit Test Runner]
        UnitPrep["test:unit:prepare\n(rimraf dist/tmp/root/test)"]
        BunDiscover[Discover test/unit/*.test.ts]
        BunRunUnit[Execute unit tests]
    end

    subgraph BunE2ERunner[Bun Runner for E2E]
        E2EPrep["test:e2e:prepare\n(rimraf dist/tmp/root/test)"]
        SetEnv[Set RUN_E2E=1]
        BunDiscoverE2E[Discover test/e2e/*.test.ts]
        BunRunE2E[Execute E2E test file]
        DriverSelect{"Driver?\n(playwright or spawn)"}
    end

    subgraph PlaywrightLayer[Playwright E2E Layer]
        PWLaunch[Launch packaged Electron app]
        PWWait[Wait for first window\nnon-CI default]
        PWSmoke[Run smoke scenario]
    end

    subgraph SpawnLayer[Spawned E2E Layer]
        SpawnLaunch[Spawn packaged Electron app]
        SpawnWait[Wait for PID + short delay]
        SpawnSmoke[Assert process stays up]
    end

    Dev --> LintCmd
    Dev --> UnitCmd
    Dev --> E2ECmd

    UnitCmd --> BunUnitRunner
    BunUnitRunner --> UnitPrep
    UnitPrep --> BunDiscover
    BunDiscover --> BunRunUnit
    BunRunUnit --> Dev

    E2ECmd --> BunE2ERunner
    BunE2ERunner --> E2EPrep
    E2EPrep --> SetEnv
    SetEnv --> BunDiscoverE2E
    BunDiscoverE2E --> BunRunE2E
    BunRunE2E --> DriverSelect
    DriverSelect --> PlaywrightLayer
    DriverSelect --> SpawnLayer
    PlaywrightLayer --> PWLaunch
    PWLaunch --> PWWait
    PWWait --> PWSmoke
    SpawnLayer --> SpawnLaunch
    SpawnLaunch --> SpawnWait
    SpawnWait --> SpawnSmoke
    PWSmoke --> Dev
    SpawnSmoke --> Dev
```

## Default test gate

`make test` runs linting plus the unit test suite. It intentionally omits
E2E tests to keep the default loop fast.
