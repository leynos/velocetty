/**
 * @file Object-key parsing for JSON5 documents.
 *
 * Responsibilities:
 * - parse quoted and unquoted property keys with their source spans.
 * - decode Unicode escapes in unquoted identifier keys.
 *
 * Invariants:
 * - a failed parse returns `null` without partial key metadata.
 *
 * Cross-links:
 * - `lexer.ts` for quoted-string and identifier scanning.
 * - `types.ts` for the parsed-key record.
 */
import JSON5 from 'json5';

import {isString} from '../../utils/runtime-guards';
import {parseIdentifierCharacter, parseQuotedStringEnd} from './lexer';
import type {ParsedObjectKey, ParseRange} from './types';

const parseQuotedKey = (raw: string, range: ParseRange): ParsedObjectKey | null => {
  const endIndex = parseQuotedStringEnd(raw, range);
  if (endIndex === -1) return null;
  try {
    const parsedKey: unknown = JSON5.parse(raw.slice(range.startIndex, endIndex));
    if (!isString(parsedKey)) {
      return null;
    }
    return {
      key: parsedKey,
      startIndex: range.startIndex,
      endIndex
    };
  } catch {
    return null;
  }
};

const parseUnquotedKey = (raw: string, range: ParseRange): ParsedObjectKey | null => {
  const firstCharacter = parseIdentifierCharacter(raw, {index: range.startIndex}, true);
  if (!firstCharacter) return null;

  let cursor = firstCharacter.nextIndex;
  let key = firstCharacter.character;
  while (cursor < range.limitIndex) {
    const nextCharacter = parseIdentifierCharacter(raw, {index: cursor}, false);
    if (!nextCharacter) break;
    key += nextCharacter.character;
    cursor = nextCharacter.nextIndex;
  }

  return {key, startIndex: range.startIndex, endIndex: cursor};
};

/** Parses a quoted or unquoted object key at the start of `range`. */
export const parseObjectKey = (raw: string, range: ParseRange): ParsedObjectKey | null => {
  const first = raw[range.startIndex];
  return first === '"' || first === "'" ? parseQuotedKey(raw, range) : parseUnquotedKey(raw, range);
};
