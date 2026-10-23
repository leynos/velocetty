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

test('the app module does not re-run configuration setup below its imports', async () => {
  // Re-adding the call here would silently reintroduce the ordering fault: the
  // import block at the top of `app/start.ts` reaches `./plugins` and
  // `./ui/window`, which evaluate before any statement in the file. The check
  // matches the call as a statement, so prose that merely names it still reads
  // naturally in the file's comments.
  const startSource = await readSource('app/start.ts');

  expect(startSource).not.toMatch(/^\s*config\.setup\(\);/m);
});
