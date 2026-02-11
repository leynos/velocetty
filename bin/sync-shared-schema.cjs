#!/usr/bin/env node
/** @file Syncs shared schema artifacts into the legacy app config location. */

const {copyFileSync, mkdirSync} = require('node:fs');
const {dirname, resolve} = require('node:path');

const sourcePath = resolve(__dirname, '../shared/schemas/schema.json');
const targetPath = resolve(__dirname, '../app/config/schema.json');

mkdirSync(dirname(targetPath), {recursive: true});
copyFileSync(sourcePath, targetPath);
