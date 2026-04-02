/** @file Minimal renderer translation hook for accessibility labels. */

const headerLabelDefaults = {
  openMenu: 'Open menu',
  minimizeWindow: 'Minimise window',
  maximizeWindow: 'Maximise window',
  restoreWindow: 'Restore window',
  closeWindow: 'Close window'
} as const;

type TranslationKey = keyof typeof headerLabelDefaults;

const translationDictionaries: Partial<Record<string, Partial<Record<TranslationKey, string>>>> = {
  en: headerLabelDefaults
};

const getPreferredLocale = () => {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  return navigator.languages?.[0] ?? navigator.language ?? 'en';
};

const getTranslationDictionary = (locale: string) => {
  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split('-')[0];

  return translationDictionaries[normalizedLocale] ?? translationDictionaries[language] ?? headerLabelDefaults;
};

export const useTranslation = () => {
  const translationDictionary = getTranslationDictionary(getPreferredLocale());

  return (key: TranslationKey) => translationDictionary[key] ?? headerLabelDefaults[key];
};
