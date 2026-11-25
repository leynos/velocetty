/**
 * @file Wire protocol between the settings renderer and the main process.
 *
 * These are types only. The main process and the renderer ship in one build,
 * so the protocol needs no version field; it is kept in `shared/` so both
 * sides and their tests agree on one definition.
 */

import type {configValidationDiagnostic} from '../types/config';
import type {JsonValue} from '../types/json';
import type {CoreSettingKey} from './core-catalogue';

/** Which setting a write or reset applies to. */
export type SettingTarget = {readonly scope: 'core'; readonly key: CoreSettingKey};

/** The state of the user's config file, as the settings tab sees it. */
export type SettingsFileStatus =
  | {readonly kind: 'ok'}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unparseable'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'legacy-json'};

/** Everything the settings tab needs to render current values. */
export type SettingsSnapshot = {
  /** Monotonic per main process; older snapshots are ignored. */
  readonly revision: number;
  /** The real path of the active config file. */
  readonly filePath: string;
  readonly fileStatus: SettingsFileStatus;
  /** Values present in the user's `config` object. */
  readonly userValues: Readonly<Record<string, JsonValue>>;
  /** Built-in defaults for every core setting. */
  readonly defaultValues: Readonly<Record<string, JsonValue>>;
  /** Keys the default profile overrides, so the UI can explain a no-op edit. */
  readonly profileOverriddenKeys: readonly string[];
};

/** Why a write did not happen. */
export type SettingsWriteFailure =
  | 'user-config-unparseable'
  | 'user-config-invalid'
  | 'legacy-json-config'
  | 'config-file-missing'
  | 'not-editable'
  | 'duplicate-key'
  | 'config-not-object'
  | 'edit-failed'
  | 'read-only'
  | 'io-error';

/** The result of one write or reset. */
export type SettingsWriteOutcome =
  | {readonly kind: 'applied'; readonly snapshot: SettingsSnapshot}
  | {readonly kind: 'rejected'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'failed'; readonly reason: SettingsWriteFailure; readonly detail?: string};
