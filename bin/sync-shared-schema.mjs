#!/usr/bin/env bun
/** @file Syncs shared schema artefacts into the legacy app config location. */
/*
 * Both schemas are copied so the packaged application can place the config
 * schema and the keybindings schema beside the files they describe.
 */
import {copyFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const syncDirectory = path.resolve(import.meta.dirname, '../shared/schemas');
const targetDirectory = path.resolve(import.meta.dirname, '../app/config');
const schemaNames = ['schema.json', 'keybindings.schema.json'];

mkdirSync(targetDirectory, {recursive: true});
for (const schemaName of schemaNames) {
  copyFileSync(path.join(syncDirectory, schemaName), path.join(targetDirectory, schemaName));
}
