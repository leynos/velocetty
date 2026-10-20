/** @file Guards TypeScript project boundaries for app/main cross-module types. */
import {expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {isString} from '@shared/types/guards';
import {isJsonObject} from '@shared/types/json';

const readWorkspaceFile = async (workspaceRelativePath: string) =>
  await fs.readFile(path.join(process.cwd(), workspaceRelativePath), 'utf8');

test('app/tsconfig includes shared runtime globals typing file', async () => {
  const appTsconfigRaw = await readWorkspaceFile('app/tsconfig.json');
  const parsedTsconfig: unknown = JSON.parse(appTsconfigRaw);
  if (!isJsonObject(parsedTsconfig) || !Array.isArray(parsedTsconfig.include)) {
    throw new Error('Expected app/tsconfig.json to contain an include array.');
  }
  const includePaths = parsedTsconfig.include.filter(isString);

  expect(includePaths).toContain('../typings/runtime-globals.d.ts');
});

test('app/start.ts imports runtime globals from typings, not lib project files', async () => {
  const appStartSource = await readWorkspaceFile('app/start.ts');

  expect(appStartSource).toContain("import type {VelocettyRuntimeGlobals} from '../typings/runtime-globals';");
  expect(appStartSource).not.toContain("import type {VelocettyRuntimeGlobals} from '../lib/utils/remote-plugins';");
});
