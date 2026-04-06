/** @file Verifies locale detection, locale matching, and translation fallback behavior. */
import {expect, test} from 'bun:test';

import {useTranslation} from '../../lib/hooks/use-translation';

type MutableNavigator = Pick<Navigator, 'languages' | 'language' | 'userAgent'>;

const restoreNavigator = (previous: PropertyDescriptor | undefined) => {
  const host = globalThis as {navigator?: Navigator};
  if (previous) {
    Object.defineProperty(host, 'navigator', previous);
    return;
  }

  delete (host as {navigator?: Navigator}).navigator;
};

const withNavigator = <T>(value: MutableNavigator | null, fn: () => T) => {
  const host = globalThis as {navigator?: Navigator};
  const previousDescriptor = Object.getOwnPropertyDescriptor(host, 'navigator');

  if (value === null) {
    Object.defineProperty(host, 'navigator', {configurable: true, value: undefined});
  } else {
    const nextNavigator: Navigator = {
      ...(host.navigator || {}),
      ...value
    } as Navigator;
    Object.defineProperty(host, 'navigator', {
      configurable: true,
      value: nextNavigator
    });
  }

  try {
    return fn();
  } finally {
    restoreNavigator(previousDescriptor);
  }
};

test('uses navigator.languages[0] for locale detection and dictionary lookup', () => {
  const translation = withNavigator({languages: ['fr-CA', 'fr'], language: 'fr'}, () => {
    const t = useTranslation();
    return t('openMenu');
  });

  expect(translation).toBe('Ouvrir le menu');
});

test('falls back to language prefix when exact locale key is missing', () => {
  const translation = withNavigator({languages: ['en-CA', 'en'], language: 'en-CA'}, () => {
    const t = useTranslation();
    return t('openMenu');
  });

  expect(translation).toBe('Open menu');
});

test('falls back to defaults when key lookup is missing from the selected dictionary', () => {
  const minimizeLabel = withNavigator({languages: ['en-gb'], language: 'en-gb'}, () => {
    const t = useTranslation();
    return t('minimizeWindow');
  });

  expect(minimizeLabel).toBe('Minimise window');
});

test('defaults to English when navigator information is unavailable', () => {
  const translation = withNavigator(null, () => {
    const t = useTranslation();
    return t('restoreWindow');
  });

  expect(translation).toBe('Restore window');
});

test('returns the translated search label for renderer search UI', () => {
  const translation = withNavigator({languages: ['fr-CA', 'fr'], language: 'fr'}, () => {
    const t = useTranslation();
    return t('search');
  });

  expect(translation).toBe('Rechercher');
});

test('returns all eight search-UI translation keys for English locale', () => {
  const results = withNavigator({languages: ['en'], language: 'en'}, () => {
    const t = useTranslation();
    return {
      search: t('search'),
      noResults: t('noResults'),
      matchCase: t('matchCase'),
      matchWholeWord: t('matchWholeWord'),
      useRegex: t('useRegex'),
      previousMatch: t('previousMatch'),
      nextMatch: t('nextMatch'),
      close: t('close')
    };
  });

  expect(results.search).toBe('Search');
  expect(results.noResults).toBe('No results');
  expect(results.matchCase).toBe('Match Case');
  expect(results.matchWholeWord).toBe('Match Whole Word');
  expect(results.useRegex).toBe('Use Regular Expression');
  expect(results.previousMatch).toBe('Previous Match');
  expect(results.nextMatch).toBe('Next Match');
  expect(results.close).toBe('Close');
});

test('returns all eight search-UI translation keys for en-gb locale', () => {
  const results = withNavigator({languages: ['en-gb'], language: 'en-gb'}, () => {
    const t = useTranslation();
    return {
      search: t('search'),
      noResults: t('noResults'),
      matchCase: t('matchCase'),
      matchWholeWord: t('matchWholeWord'),
      useRegex: t('useRegex'),
      previousMatch: t('previousMatch'),
      nextMatch: t('nextMatch'),
      close: t('close')
    };
  });

  expect(results.search).toBe('Search');
  expect(results.noResults).toBe('No results');
  expect(results.matchCase).toBe('Match Case');
  expect(results.matchWholeWord).toBe('Match Whole Word');
  expect(results.useRegex).toBe('Use Regular Expression');
  expect(results.previousMatch).toBe('Previous Match');
  expect(results.nextMatch).toBe('Next Match');
  expect(results.close).toBe('Close');
});

test('returns all eight search-UI translation keys for French locale', () => {
  const results = withNavigator({languages: ['fr'], language: 'fr'}, () => {
    const t = useTranslation();
    return {
      search: t('search'),
      noResults: t('noResults'),
      matchCase: t('matchCase'),
      matchWholeWord: t('matchWholeWord'),
      useRegex: t('useRegex'),
      previousMatch: t('previousMatch'),
      nextMatch: t('nextMatch'),
      close: t('close')
    };
  });

  expect(results.search).toBe('Rechercher');
  expect(results.noResults).toBe('Aucun résultat');
  expect(results.matchCase).toBe('Respecter la casse');
  expect(results.matchWholeWord).toBe('Mot entier');
  expect(results.useRegex).toBe('Expression régulière');
  expect(results.previousMatch).toBe('Résultat précédent');
  expect(results.nextMatch).toBe('Résultat suivant');
  expect(results.close).toBe('Fermer');
});
