/**
 * @file Branded JSON5 document text shared by the scanner modules.
 *
 * Responsibilities:
 * - give the raw document string a domain type the scanning steps can share.
 * - provide the only constructor, so the brand means "text one parser owns".
 *
 * Invariants:
 * - the brand is compile-time only; no runtime wrapper is allocated.
 *
 * Cross-links:
 * - `lexer.ts` and `property-list.ts` for the steps that consume it.
 * - `types.ts` for the range records scanned within it.
 */

/** JSON5 document text owned by one parser instance. */
export type SourceText = string & {readonly __brand: 'SourceText'};

/**
 * Brands document text for the scanning steps.
 *
 * @param raw - The document text.
 * @returns The same text, branded for scanning.
 *
 * @example
 * sourceText('{config: {}}'); // '{config: {}}'
 */
export const sourceText = (raw: string): SourceText =>
  // SAFETY: the brand names text the caller already holds as a document; it
  // claims no validation and adds no runtime representation.
  raw as SourceText;
