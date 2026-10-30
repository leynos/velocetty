/** @file Legacy `config.json5` keymaps classification and migration notices. */
/*
 * The importer has to tell the policy whether the old `keymaps` key is usable
 * before start-up may seed a keybindings file. That decision is a pure
 * classification, and the notices that accompany it fire at most once per
 * process, so a burst of reloads cannot repeat them.
 */
import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import {notifyWithPrimaryDiagnostic, type ConfigImportNotify} from './keybindings';
import {parseKeybindingsText, serializeKeybindings, toRawKeymaps} from './keybindings-codec';
import type {LegacyKeymapsSource, UserKeymaps} from './keybindings-policy';

/**
 * Reads the legacy `keymaps` key that `rawConfig` deprecates.
 *
 * This module owns the migration, so it is also the one place allowed to touch
 * the deprecated key. Everything else asks for the keymaps in effect.
 *
 * @example
 * ```ts
 * readLegacyKeymaps({plugins: []}); // {}
 * ```
 */
export const readLegacyKeymaps = (config: rawConfig): UserKeymaps => {
  // oxlint-disable-next-line typescript/no-deprecated -- Migrating the key requires reading it.
  return config.keymaps ?? {};
};

/**
 * Stores keymaps under the legacy key for the parts of the app that still read it.
 *
 * @example
 * ```ts
 * const config: rawConfig = {};
 * replaceLegacyKeymaps(config, {'window:new': 'ctrl+n'});
 * ```
 */
export const replaceLegacyKeymaps = (config: rawConfig, keymaps: UserKeymaps): void => {
  // oxlint-disable-next-line typescript/no-deprecated -- init still merges this key.
  config.keymaps = toRawKeymaps(keymaps);
};

/** What `config.json5` held before the keybindings file existed. */
export type LegacyKeymapsInput = {
  readonly keymaps: UserKeymaps;
  /** The config file path, used as the diagnostics label. */
  readonly source: string;
  /** Whether start-up had to create `config.json5` from the defaults. */
  readonly bootstrapped: boolean;
  /** Whether the config file failed to load and the defaults were used. */
  readonly usedFallback: boolean;
};

/** A legacy source plus the diagnostics that made it unusable, if any. */
export type LegacyKeymapsClassification = {
  readonly legacy: LegacyKeymapsSource;
  readonly diagnostics: readonly configValidationDiagnostic[];
};

/**
 * Classifies the legacy keymaps for {@link decideBootstrap}.
 *
 * Keymaps are validated with the same codec the file uses, so a value that
 * would produce an invalid `keybindings.json5` is reported and never seeded.
 *
 * @example
 * ```ts
 * classifyLegacyKeymaps({bootstrapped: false, keymaps: {}, source, usedFallback: false});
 * // {diagnostics: [], legacy: {kind: 'parsed-empty'}}
 * ```
 */
export const classifyLegacyKeymaps = (input: LegacyKeymapsInput): LegacyKeymapsClassification => {
  if (input.bootstrapped) {
    return {diagnostics: [], legacy: {kind: 'freshly-created'}};
  }
  if (input.usedFallback) {
    return {diagnostics: [], legacy: {kind: 'fell-back'}};
  }
  if (Object.keys(input.keymaps).length === 0) {
    return {diagnostics: [], legacy: {kind: 'parsed-empty'}};
  }
  const parsed = parseKeybindingsText(serializeKeybindings(input.keymaps), input.source);
  if (parsed.kind === 'invalid') {
    return {diagnostics: parsed.diagnostics, legacy: {kind: 'parsed-invalid'}};
  }
  return {diagnostics: [], legacy: {keymaps: parsed.keymaps, kind: 'parsed-keymaps'}};
};

/** The one-per-process notices the importer may show. */
export type KeybindingsNotices = {
  readonly announceSeeded: () => void;
  readonly announceLegacyIgnored: () => void;
  readonly announceDeferred: (diagnostics: readonly configValidationDiagnostic[]) => void;
  readonly announceShadowed: (paths: readonly string[]) => void;
};

/**
 * Creates the migration and configuration-tree notices.
 *
 * Each notice fires at most once per process. Repeating them on every reload
 * would train users to ignore them.
 *
 * @example
 * ```ts
 * const notices = createKeybindingsNotices(notify);
 * notices.announceSeeded(); // "Shortcuts moved to keybindings.json5"
 * notices.announceSeeded(); // no second notification
 * ```
 */
export const createKeybindingsNotices = (notify: ConfigImportNotify): KeybindingsNotices => {
  let seeded = false;
  let legacyIgnored = false;
  let deferred = false;
  let shadowed = false;

  return {
    announceDeferred: (diagnostics) => {
      if (deferred || diagnostics.length === 0) {
        return;
      }
      deferred = true;
      notifyWithPrimaryDiagnostic(
        notify,
        "Couldn't move shortcuts to keybindings.json5. Fix the keymaps in config.json5 to migrate them.",
        diagnostics
      );
    },
    announceLegacyIgnored: () => {
      if (legacyIgnored) {
        return;
      }
      legacyIgnored = true;
      notify(
        'Shortcuts in config.json5 are ignored',
        'keybindings.json5 takes precedence, so the keymaps key in config.json5 is not used.'
      );
    },
    announceSeeded: () => {
      if (seeded) {
        return;
      }
      seeded = true;
      notify(
        'Shortcuts moved to keybindings.json5',
        'Your shortcuts now live in keybindings.json5. The keymaps key in config.json5 is no longer read.'
      );
    },
    announceShadowed: (paths) => {
      if (shadowed || paths.length === 0) {
        return;
      }
      shadowed = true;
      notify('Using the Velocetty configuration', `Ignoring the lower-priority copy at ${paths.join(', ')}.`);
    }
  };
};
