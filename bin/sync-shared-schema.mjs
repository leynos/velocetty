#!/usr/bin/env bun
/** @file Syncs shared schema artefacts into the legacy app config location. */

import {copyFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(import.meta.dirname, '../shared/schemas/schema.json');
const targetPath = path.resolve(import.meta.dirname, '../app/config/schema.json');

mkdirSync(path.dirname(targetPath), {recursive: true});
copyFileSync(sourcePath, targetPath);
