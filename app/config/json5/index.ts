/**
 * @file Public entry point for the JSON5 range scanner and document edits.
 *
 * Responsibilities:
 * - expose the range records and `Json5Parser` used by config persistence.
 * - expose the comment-preserving set and remove operations.
 *
 * Invariants:
 * - the exported surface stays limited to range records, the key brand, the
 *   parser facade, and the two edit functions.
 *
 * Cross-links:
 * - `parser.ts` for the parser implementation.
 * - `document-edit.ts` and `document-remove.ts` for the edits.
 * - `types.ts` for the exported records and key constructor.
 */
export {Json5Parser} from './parser';
export {propertyKey} from './types';
export type {IndexCursor, Json5ObjectProperty, Json5ObjectRange, ParseRange, PropertyKey} from './types';
export {setPropertyAtPath} from './document-edit';
export {removePropertyAtPath} from './document-remove';
export {json5Document} from './document-result';
export type {DocumentEditResult, DocumentRefusalReason, Json5Document} from './document-result';
export type {PropertyPath} from './document-scan';
