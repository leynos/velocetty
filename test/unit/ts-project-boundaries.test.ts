/** @file Guards TypeScript project boundaries for app/main cross-module types. */
import {expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

const readWorkspaceFile = async (workspaceRelativePath: string) =>
  await fs.readFile(path.join(process.cwd(), workspaceRelativePath), 'utf8');

test('app/tsconfig includes shared runtime globals typing file', async () => {
  const appTsconfigRaw = await readWorkspaceFile('app/tsconfig.json');
  const appTsconfig = JSON.parse(appTsconfigRaw) as {include?: string[]};

  expect(appTsconfig.include).toBeDefined();
  expect(appTsconfig.include).toContain('../typings/runtime-globals.d.ts');
});

test('app/index imports runtime globals from typings, not lib project files', async () => {
  const appIndexSource = await readWorkspaceFile('app/index.ts');

  expect(appIndexSource).toContain("import type {VelocettyRuntimeGlobals} from '../typings/runtime-globals';");
  expect(appIndexSource).not.toContain("import type {VelocettyRuntimeGlobals} from '../lib/utils/remote-plugins';");
});
