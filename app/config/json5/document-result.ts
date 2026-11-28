/**
 * @file Result types shared by the JSON5 document edits.
 */

import type {DocumentRefusalReason} from './document-scan';

export type {DocumentRefusalReason, PropertyPath} from './document-scan';

/** A raw JSON5 document, branded to keep it apart from arbitrary text. */
export type Json5Document = string & {readonly __brand: 'Json5Document'};

/**
 * Brands raw text as a JSON5 document.
 *
 * @param raw - The document text.
 * @returns The branded document; no validation is performed.
 *
 * @example
 * json5Document('{}'); // '{}'
 */
export const json5Document = (raw: string): Json5Document =>
  // SAFETY: the brand marks text for the parser-backed editing API only; it
  // does not claim the text is valid JSON5.
  raw as Json5Document;

/** The outcome of one edit. */
export type DocumentEditResult =
  | {readonly kind: 'edited'; readonly doc: Json5Document}
  | {readonly kind: 'refused'; readonly reason: DocumentRefusalReason};

/**
 * Wraps an edited document.
 *
 * @param doc - The edited text.
 * @returns An edited result.
 *
 * @example
 * edited('{}').kind; // 'edited'
 */
export const edited = (doc: string): DocumentEditResult => ({kind: 'edited', doc: json5Document(doc)});

/**
 * Wraps a refusal.
 *
 * @param reason - Why the edit was refused.
 * @returns A refused result.
 *
 * @example
 * refused('duplicate-key').kind; // 'refused'
 */
export const refused = (reason: DocumentRefusalReason): DocumentEditResult => ({kind: 'refused', reason});
