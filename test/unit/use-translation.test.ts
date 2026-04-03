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
