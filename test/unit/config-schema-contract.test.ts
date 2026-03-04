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

const processArrayNode = (current: unknown[], stack: unknown[]): void => {
  for (const entry of current) {
    stack.push(entry);
  }
};

const isContextCapSchema = (key: string, value: unknown): value is JsonObject =>
  key === 'webGLRendererMaxContexts' && value != null && typeof value === 'object';

const processObjectNode = (current: JsonObject, stack: unknown[], matches: JsonObject[]): void => {
  for (const [key, value] of Object.entries(current)) {
    if (isContextCapSchema(key, value)) {
      matches.push(value);
    }
    stack.push(value);
  }
};

const collectContextCapSchemas = (node: unknown): JsonObject[] => {
  const matches: JsonObject[] = [];
  const stack: unknown[] = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      processArrayNode(current, stack);
      continue;
    }

    if (!current || typeof current !== 'object') {
      continue;
    }

    processObjectNode(current as JsonObject, stack, matches);
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
