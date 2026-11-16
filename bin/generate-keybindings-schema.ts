#!/usr/bin/env bun
/** @file Generates the draft-07 JSON Schema for `keybindings.json5`. */
/*
 * The schema comes from the codec's own Zod schema, so editors and the runtime
 * cannot drift apart. Importing the codec (rather than `zod` directly) also
 * pins generation to the Zod copy the application resolves.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {keybindingsJsonSchema} from '../app/config/keybindings-codec';

const targetPath = path.resolve(import.meta.dirname, '../shared/schemas/keybindings.schema.json');

mkdirSync(path.dirname(targetPath), {recursive: true});
writeFileSync(targetPath, `${JSON.stringify(keybindingsJsonSchema(), null, 2)}\n`, 'utf8');
