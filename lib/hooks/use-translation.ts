/** @file Minimal renderer translation hook for accessibility labels. */

const headerLabelDefaults = {
  openMenu: 'Open menu',
  minimizeWindow: 'Minimize window',
  maximizeWindow: 'Maximize window',
  restoreWindow: 'Restore window',
  closeWindow: 'Close window',
  search: 'Search',
  noResults: 'No results',
  matchCase: 'Match Case',
  matchWholeWord: 'Match Whole Word',
  useRegex: 'Use Regular Expression',
  previousMatch: 'Previous Match',
  nextMatch: 'Next Match',
  close: 'Close'
} as const;

type TranslationKey = keyof typeof headerLabelDefaults;

const translationDictionaries = {
  en: headerLabelDefaults,
  'en-gb': {
    openMenu: 'Open menu (UK)',
    closeWindow: 'Close the window',
    search: 'Search',
    noResults: 'No results',
    matchCase: 'Match Case',
    matchWholeWord: 'Match Whole Word',
    useRegex: 'Use Regular Expression',
    previousMatch: 'Previous Match',
    nextMatch: 'Next Match',
    close: 'Close'
  },
  fr: {
    openMenu: 'Ouvrir le menu',
    closeWindow: 'Fermer la fenêtre',
    search: 'Rechercher',
    noResults: 'Aucun résultat',
    matchCase: 'Respecter la casse',
    matchWholeWord: 'Mot entier',
    useRegex: 'Expression régulière',
    previousMatch: 'Résultat précédent',
    nextMatch: 'Résultat suivant',
    close: 'Fermer'
  }
} satisfies Partial<Record<string, Partial<Record<TranslationKey, string>>>>;

const getPreferredLocale = () => {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  return navigator.languages.at(0) ?? (navigator.language || 'en');
};

type TranslationDictionaries = typeof translationDictionaries;
type TranslationDictionary = Partial<Record<TranslationKey, string>>;

/**
 * Narrows a locale tag to a key of the bundled dictionaries.
 *
 * Navigator locales are arbitrary strings; a miss falls through to the
 * language subtag and then to the default dictionary.
 */
const asKnownLocale = (locale: string): keyof TranslationDictionaries | undefined => {
  if (!Object.hasOwn(translationDictionaries, locale)) {
    return undefined;
  }
  // SAFETY: `hasOwn` just proved the property exists on the dictionaries
  // object, whose keys are exactly the locales it was built from.
  return locale as keyof TranslationDictionaries;
};

const getTranslationDictionary = (locale: string): TranslationDictionary => {
  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split('-')[0];

  const localeKey = asKnownLocale(normalizedLocale);
  const languageKey = asKnownLocale(language);
  const dictionary = localeKey ?? languageKey;
  return dictionary ? translationDictionaries[dictionary] : headerLabelDefaults;
};

export const useTranslation = () => {
  const translationDictionary = getTranslationDictionary(getPreferredLocale());

  return (key: TranslationKey) => translationDictionary[key] ?? headerLabelDefaults[key];
};
