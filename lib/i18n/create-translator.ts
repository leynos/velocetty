/**
 * @file Minimal dictionary translator shared by the renderer surfaces.
 *
 * One function of a key, falling back to the key itself, is all this project's
 * handwritten dictionaries need. Extracting it keeps the header labels and the
 * settings strings on one resolution rule.
 */

/** A flat dictionary of human-readable strings. */
export type TranslationDictionary = Readonly<Record<string, string>>;

/**
 * Builds a translator over one or more dictionaries, later entries winning.
 *
 * @param dictionaries - The dictionaries to merge, highest priority last.
 * @returns A function from key to text, falling back to the key.
 *
 * @example
 * const t = createTranslator({hello: 'Hello'});
 * t('hello'); // 'Hello'
 * t('missing'); // 'missing'
 */
export const createTranslator = (...dictionaries: readonly TranslationDictionary[]): ((key: string) => string) => {
  const merged: Record<string, string> = {};
  for (const dictionary of dictionaries) {
    Object.assign(merged, dictionary);
  }
  return (key: string): string => merged[key] ?? key;
};
