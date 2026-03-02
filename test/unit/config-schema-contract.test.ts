/** @file Guards generated JSON schema constraints for configuration contracts. */
import {expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

type JsonObject = Record<string, unknown>;

const readJsonFile = async (workspaceRelativePath: string): Promise<unknown> => {
  const filePath = path.join(process.cwd(), workspaceRelativePath);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
};

const collectContextCapSchemas = (node: unknown): JsonObject[] => {
  const matches: JsonObject[] = [];
  const stack: unknown[] = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const entry of current) {
        stack.push(entry);
      }
      continue;
    }

    if (!current || typeof current !== 'object') {
      continue;
    }

    for (const [key, value] of Object.entries(current as JsonObject)) {
      if (key === 'webGLRendererMaxContexts' && value && typeof value === 'object') {
        matches.push(value as JsonObject);
      }
      stack.push(value);
    }
  }

  return matches;
};

test('generated config schemas enforce webGLRendererMaxContexts as integer >= 1', async () => {
  const schemaFiles = ['app/config/schema.json', 'shared/schemas/schema.json'];

  for (const schemaFile of schemaFiles) {
    const schemaRoot = await readJsonFile(schemaFile);
    const contextCaps = collectContextCapSchemas(schemaRoot);

    expect(contextCaps.length).toBe(2);

    for (const contextCap of contextCaps) {
      expect(contextCap.type).toBe('integer');
      expect(contextCap.minimum).toBe(1);
    }
  }
});
