/** @file Guards generated JSON schema constraints for configuration contracts. */
import {expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {isJsonObject, isJsonValue, type JsonObject, type JsonValue} from '@shared/types/json';

const readJsonFile = async (workspaceRelativePath: string): Promise<JsonValue> => {
  const filePath = path.join(process.cwd(), workspaceRelativePath);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonValue(parsed)) {
    throw new Error(`Expected JSON-compatible content in ${workspaceRelativePath}.`);
  }
  return parsed;
};

const processArrayNode = (current: JsonValue[], stack: JsonValue[]): void => {
  for (const entry of current) {
    stack.push(entry);
  }
};

const isContextCapSchema = (key: string, value: JsonValue): value is JsonObject =>
  key === 'webGLRendererMaxContexts' && isJsonObject(value);

const processObjectNode = (current: JsonObject, stack: JsonValue[], matches: JsonObject[]): void => {
  for (const [key, value] of Object.entries(current)) {
    if (isContextCapSchema(key, value)) {
      matches.push(value);
    }
    stack.push(value);
  }
};

const collectContextCapSchemas = (node: JsonValue): JsonObject[] => {
  const matches: JsonObject[] = [];
  const stack: JsonValue[] = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      processArrayNode(current, stack);
      continue;
    }

    if (!isJsonObject(current)) {
      continue;
    }

    processObjectNode(current, stack, matches);
  }

  return matches;
};

test('generated config schemas enforce webGLRendererMaxContexts as integer >= 1', async () => {
  const schemaFiles = ['app/config/schema.json', 'shared/schemas/schema.json'];
  const schemaResults = await Promise.allSettled(
    schemaFiles.map(async (schemaFile) => ({
      schemaFile,
      schemaRoot: await readJsonFile(schemaFile)
    }))
  );

  for (const [index, result] of schemaResults.entries()) {
    const schemaFile = schemaFiles[index];
    if (result.status !== 'fulfilled') {
      throw new Error(`Failed to read schema file "${schemaFile}": ${String(result.reason)}`);
    }
    const schemaRoot = result.value.schemaRoot;
    const contextCaps = collectContextCapSchemas(schemaRoot);

    expect(contextCaps.length).toBe(2);

    for (const contextCap of contextCaps) {
      expect(contextCap.type).toBe('integer');
      expect(contextCap.minimum).toBe(1);
    }
  }
});
