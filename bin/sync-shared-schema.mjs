#!/usr/bin/env bun
/** @file Syncs shared schema artifacts into the legacy app config location. */

import {copyFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

const sourcePath = resolve(import.meta.dirname, '../shared/schemas/schema.json');
const targetPath = resolve(import.meta.dirname, '../app/config/schema.json');

mkdirSync(dirname(targetPath), {recursive: true});
copyFileSync(sourcePath, targetPath);
