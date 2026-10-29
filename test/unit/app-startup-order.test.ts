/** @file Pins the startup order that configuration initialization depends on. */
import {expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

const readSource = async (workspaceRelativePath: string) =>
  await fs.readFile(path.join(process.cwd(), workspaceRelativePath), 'utf8');

const indexOfOrThrow = (source: string, needle: string): number => {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`Expected the source to contain ${JSON.stringify(needle)}.`);
  }
  return index;
};

test('the entry point initializes the configuration before loading the app', async () => {
  // Two modules read the configuration while their own module body runs:
  // `app/plugins.ts` resolves the plugin and local-plugin lists, and
  // `app/session.ts` reads `useConpty`. Node evaluates a required module as
  // soon as it is required, so `config.setup()` has to happen above the import
  // of `./start.js`. It cannot live inside `./start.js` instead, because every
  // statement in that file runs after its own imports have been evaluated.
  const entrySource = await readSource('app/index.mts');
  const setupIndex = indexOfOrThrow(entrySource, 'config.setup();');
  const startImportIndex = indexOfOrThrow(entrySource, "await import('./start.js')");

  expect(setupIndex).toBeLessThan(startImportIndex);
});

test('the entry point answers every informational argument the same way', async () => {
  // These arguments must short-circuit before `config.setup()` and before
  // `./start.js`. If one ever fell through to the startup path it would launch a
  // window instead of printing diagnostics, so the list is pinned as a whole.
  const entrySource = await readSource('app/index.mts');

  expect(entrySource).toContain("const informationalArguments = ['--help', '-v', '--version'];");
  expect(entrySource).toContain('informationalArguments.includes(requestedArgument)');
  expect(entrySource).toContain('app.quit();');
});

test('the informational branch reports the version, the argument contract and the resolved paths', async () => {
  // These lines are the entire user-visible output of `--help`. Losing one
  // is silent at runtime: the process still exits 0 with partial guidance.
  const entrySource = await readSource('app/index.mts');

  // Matched as patterns rather than as templates: these are the literal
  // interpolations the entry point prints, and evaluating them here would test
  // this file's own variables instead.
  expect(entrySource).toMatch(/Hyper version \$\{packageMetadata\.version\}/);
  expect(entrySource).toContain('Hyper does not accept any command line arguments.');
  expect(entrySource).toMatch(/Hyper configuration file located at: \$\{cfgPath\}/);
  expect(entrySource).toMatch(/Hyper keybindings file located at: \$\{keybindingsPath\}/);
  expect(entrySource).toMatch(/Hyper configuration tree in use: \$\{configTree\}/);
});

test('a startup failure is reported and turns into a failing exit code', async () => {
  // The catch block is the only thing standing between a broken `config.setup()`
  // and an Electron process that exits 0 with no window, so both halves of the
  // contract are pinned: the diagnostic and the non-zero status.
  const entrySource = await readSource('app/index.mts');
  const catchIndex = indexOfOrThrow(entrySource, '} catch (error) {');
  const catchBlock = entrySource.slice(catchIndex);

  expect(catchBlock).toContain("console.error('Failed to start Hyper.', error);");
  expect(catchBlock).toContain('process.exitCode = 1;');
  expect(catchBlock).toContain('app.quit();');
});

test('the app module does not re-run configuration setup below its imports', async () => {
  // Re-adding the call here would silently reintroduce the ordering fault: the
  // import block at the top of `app/start.ts` reaches `./plugins` and
  // `./ui/window`, which evaluate before any statement in the file. The check
  // matches the call as a statement, so prose that merely names it still reads
  // naturally in the file's comments.
  const startSource = await readSource('app/start.ts');

  expect(startSource).not.toMatch(/^\s*config\.setup\(\);/m);
});
