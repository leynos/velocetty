/**
 * @file The banner and row-disabled messages the settings container derives
 * from the active file's state.
 *
 * A schema-invalid file may be repaired one diagnosed key at a time, so the
 * ownership rule here decides which rows stay editable. Kept apart from the
 * connected container so the rules can be tested without the transport graph.
 */
import {settingsStrings} from './i18n';

import type {CoreSettingKey} from '@shared/settings/core-catalogue';
import type {SettingsFileStatus} from '@shared/settings/protocol';

export const bannerFor = (status: SettingsFileStatus | null, loadError: string | null): string | null => {
  if (loadError !== null) {
    return loadError;
  }
  if (status === null || status.kind === 'ok') {
    return null;
  }
  switch (status.kind) {
    case 'missing': {
      return settingsStrings.missingBanner;
    }
    case 'unparseable': {
      return settingsStrings.unparseableBanner;
    }
    case 'invalid': {
      const problems = status.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`);
      return [settingsStrings.invalidBanner, ...problems].join(' ');
    }
    case 'legacy-json': {
      return settingsStrings.legacyBanner;
    }
  }
};

/** The fixed row reason for a file state that blocks every row. */
const blockedRowReason = {
  missing: settingsStrings.missingRow,
  'legacy-json': settingsStrings.legacyRow,
  unparseable: settingsStrings.unparseableRow
} as const;

/** Whether the file's diagnostics name this key or one of its descendants. */
const ownsDiagnostic = (key: CoreSettingKey, status: Extract<SettingsFileStatus, {kind: 'invalid'}>): boolean => {
  const keyPath = `/config/${key}`;
  return status.diagnostics.some(
    (diagnostic) => diagnostic.path === keyPath || diagnostic.path.startsWith(`${keyPath}/`)
  );
};

/**
 * Explains why a row cannot be edited in the file's current state.
 *
 * @param key - The setting key.
 * @param status - The file status, or null before the first load.
 * @returns A reason, or undefined when the row is editable.
 */
export const disabledReasonFor = (key: CoreSettingKey, status: SettingsFileStatus | null): string | undefined => {
  if (status === null || status.kind === 'ok') {
    return undefined;
  }
  if (status.kind === 'invalid') {
    return ownsDiagnostic(key, status) ? undefined : settingsStrings.invalidRow;
  }
  return blockedRowReason[status.kind];
};
