/**
 * @file File-state decisions the settings container makes for rows and banners.
 *
 * A broken banner or ownership rule would leave a schema-invalid key disabled
 * (or allow editing an unrelated one) while every service test stayed green.
 */
import {describe, expect, test} from 'bun:test';

import {bannerFor, disabledReasonFor} from '../../lib/settings/file-state-messages';
import {settingsStrings} from '../../lib/settings/i18n';

import type {SettingsFileStatus} from '@shared/settings/protocol';

const invalidStatus: SettingsFileStatus = {
  kind: 'invalid',
  diagnostics: [{path: '/config/fontSize', message: 'Expected a number.', suggestedFix: 'Enter a number.'}]
};

describe('bannerFor', () => {
  test('a load error wins over the file status', () => {
    expect(bannerFor({kind: 'ok'}, 'Could not load settings.')).toBe('Could not load settings.');
  });

  test('each file state has its own banner', () => {
    expect(bannerFor({kind: 'ok'}, null)).toBeNull();
    expect(bannerFor({kind: 'missing'}, null)).toBe(settingsStrings.missingBanner);
    expect(bannerFor({kind: 'unparseable', diagnostics: []}, null)).toBe(settingsStrings.unparseableBanner);
    expect(bannerFor({kind: 'legacy-json'}, null)).toBe(settingsStrings.legacyBanner);
  });

  test('an invalid file lists every diagnostic', () => {
    const banner = bannerFor(invalidStatus, null);
    expect(banner).toContain(settingsStrings.invalidBanner);
    expect(banner).toContain('/config/fontSize');
    expect(banner).toContain('Expected a number.');
  });
});

describe('disabledReasonFor', () => {
  test('a healthy or missing file disables nothing', () => {
    expect(disabledReasonFor('fontSize', {kind: 'ok'})).toBeUndefined();
    expect(disabledReasonFor('fontSize', null)).toBeUndefined();
  });

  test('only the diagnosed key stays editable in an invalid file', () => {
    expect(disabledReasonFor('fontSize', invalidStatus)).toBeUndefined();
    expect(disabledReasonFor('shell', invalidStatus)).toBe(settingsStrings.invalidRow);
  });

  test('a nested diagnostic also owns its key', () => {
    const nested: SettingsFileStatus = {
      kind: 'invalid',
      diagnostics: [{path: '/config/shell/args', message: 'bad', suggestedFix: 'fix'}]
    };
    expect(disabledReasonFor('shell', nested)).toBeUndefined();
  });

  test('legacy and unparseable files disable every row', () => {
    expect(disabledReasonFor('fontSize', {kind: 'legacy-json'})).toBe(settingsStrings.legacyRow);
    expect(disabledReasonFor('fontSize', {kind: 'unparseable', diagnostics: []})).toBe(settingsStrings.unparseableRow);
  });
});
