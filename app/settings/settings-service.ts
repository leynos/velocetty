/**
 * @file The main-process settings authority.
 *
 * The service answers "what are the current values?" and performs writes and
 * resets through the single config writer. It owns the two file-state rules:
 * a legacy `hyper.json` is read-only, and a schema-invalid file may only be
 * edited on the keys that carry a diagnostic, so a user can fix it without the
 * UI pretending a write was saved.
 */

import JSON5 from 'json5';

import {
  lastPathSegment,
  type ConfigEditRequest,
  type ConfigFileSystemPort,
  type ConfigWriterDependencies,
  writeConfigEdit
} from '../config/config-file-writer';
import {validateConfigOptions} from '../config/json5-config';
import {isJsonObject} from '../utils/runtime-guards';
import {checkWritePolicy, isWritableSettingKey} from './settings-write-policy';

import type {configValidationDiagnostic} from '@shared/types/config';
import type {JsonObject, JsonValue} from '@shared/types/json';
import type {
  SettingTarget,
  SettingsFileStatus,
  SettingsSnapshot,
  SettingsWriteFailure,
  SettingsWriteOutcome
} from '@shared/settings/protocol';

/** The injected dependencies of the settings service. */
export type SettingsServiceDependencies = {
  /** The active config file; a `.json` path is the legacy file. */
  readonly filePath: string;
  readonly fileSystem: ConfigFileSystemPort;
  readonly writer: ConfigWriterDependencies;
  /** The built-in defaults, as they appear in `config-default.json`. */
  readonly defaults: JsonObject;
  readonly getDefaultProfileName: () => string;
};

/** The service the IPC layer calls. */
export type SettingsService = {
  readonly getSnapshot: () => SettingsSnapshot;
  readonly setValue: (target: SettingTarget, value: JsonValue) => Promise<SettingsWriteOutcome>;
  readonly resetValue: (target: SettingTarget) => Promise<SettingsWriteOutcome>;
};

type FileRead =
  | {readonly kind: 'missing'}
  | {readonly kind: 'legacy'; readonly userValues: JsonObject}
  | {readonly kind: 'unparseable'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {
      readonly kind: 'invalid';
      readonly diagnostics: readonly configValidationDiagnostic[];
      readonly userValues: JsonObject;
    }
  | {readonly kind: 'ok'; readonly userValues: JsonObject};

const isLegacyPath = (filePath: string): boolean => filePath.toLowerCase().endsWith('.json');

const diagnostic = (path: string, message: string, suggestedFix: string): configValidationDiagnostic => ({
  path,
  message,
  suggestedFix
});

const parseDiagnostics = (error: unknown): readonly configValidationDiagnostic[] => [
  diagnostic(
    '/',
    error instanceof Error ? error.message : 'The config file could not be parsed.',
    'Fix the JSON5 syntax and save the file.'
  )
];

const userValuesOf = (parsed: JsonValue): JsonObject =>
  isJsonObject(parsed) && isJsonObject(parsed.config) ? parsed.config : {};

const readConfigFile = (dependencies: SettingsServiceDependencies): FileRead => {
  if (dependencies.fileSystem.stat(dependencies.filePath) === null) {
    return {kind: 'missing'};
  }
  let text: string;
  try {
    text = dependencies.fileSystem.readText(dependencies.filePath);
  } catch {
    return {
      kind: 'unparseable',
      diagnostics: [diagnostic('/', 'The config file could not be read.', 'Check the file permissions.')]
    };
  }
  let parsed: JsonValue;
  try {
    // SAFETY: JSON5.parse produces only JSON5 primitives, arrays, and objects.
    parsed = JSON5.parse(text) as JsonValue;
  } catch (error) {
    return {kind: 'unparseable', diagnostics: parseDiagnostics(error)};
  }
  const userValues = userValuesOf(parsed);
  if (isLegacyPath(dependencies.filePath)) {
    return {kind: 'legacy', userValues};
  }
  if (!isJsonObject(parsed) || !isJsonObject(parsed.config)) {
    return {
      kind: 'invalid',
      userValues,
      diagnostics: [diagnostic('/config', 'Expected `config` to be an object.', 'Set `config` to an object value.')]
    };
  }
  const diagnostics = validateConfig(parsed.config);
  if (diagnostics.length > 0) {
    return {kind: 'invalid', userValues, diagnostics};
  }
  return {kind: 'ok', userValues};
};

const validateConfig = (config: JsonObject): readonly configValidationDiagnostic[] => validateConfigOptions(config);

const statusOf = (read: FileRead): SettingsFileStatus => {
  switch (read.kind) {
    case 'missing': {
      return {kind: 'missing'};
    }
    case 'legacy': {
      return {kind: 'legacy-json'};
    }
    case 'unparseable': {
      return {kind: 'unparseable', diagnostics: read.diagnostics};
    }
    case 'invalid': {
      return {kind: 'invalid', diagnostics: read.diagnostics};
    }
    case 'ok': {
      return {kind: 'ok'};
    }
  }
};

const coreDefaults = (defaults: JsonObject): JsonObject => {
  const values: JsonObject = {};
  for (const key of Object.keys(defaults)) {
    if (isWritableSettingKey(key)) {
      values[key] = defaults[key];
    }
  }
  return values;
};

const profileOverriddenKeys = (userValues: JsonObject, defaultProfileName: string): readonly string[] => {
  const profiles = userValues.profiles;
  if (!Array.isArray(profiles)) {
    return [];
  }
  const profile = profiles.find((candidate) => isJsonObject(candidate) && candidate.name === defaultProfileName);
  if (!isJsonObject(profile) || !isJsonObject(profile.config)) {
    return [];
  }
  return Object.keys(profile.config);
};

const concernsKey = (item: configValidationDiagnostic, key: string): boolean =>
  item.path === `/config/${key}` || item.path.startsWith(`/config/${key}/`);

const refusedOutcome = (reason: SettingsWriteFailure): SettingsWriteOutcome => ({kind: 'failed', reason});

type Precheck = {readonly kind: 'proceed'} | {readonly kind: 'refused'; readonly outcome: SettingsWriteOutcome};

/**
 * Creates the settings service.
 *
 * @param dependencies - File-system, writer, and defaults.
 * @returns The service used by the IPC handlers.
 *
 * @example
 * const service = createSettingsService({filePath, fileSystem, writer, defaults, getDefaultProfileName});
 * service.getSnapshot().fileStatus.kind; // 'ok'
 */
export const createSettingsService = (dependencies: SettingsServiceDependencies): SettingsService => {
  const snapshotOf = (read: FileRead): SettingsSnapshot => ({
    revision: dependencies.writer.currentRevision(),
    filePath: dependencies.filePath,
    fileStatus: statusOf(read),
    userValues: 'userValues' in read ? read.userValues : {},
    defaultValues: coreDefaults(dependencies.defaults),
    profileOverriddenKeys: profileOverriddenKeys(
      'userValues' in read ? read.userValues : {},
      dependencies.getDefaultProfileName()
    )
  });

  const getSnapshot = (): SettingsSnapshot => snapshotOf(readConfigFile(dependencies));

  const precheck = (target: SettingTarget): Precheck => {
    if (isLegacyPath(dependencies.filePath)) {
      return {kind: 'refused', outcome: refusedOutcome('legacy-json-config')};
    }
    const read = readConfigFile(dependencies);
    if (read.kind === 'missing') {
      return {kind: 'refused', outcome: refusedOutcome('config-file-missing')};
    }
    if (read.kind === 'unparseable') {
      return {kind: 'refused', outcome: refusedOutcome('user-config-unparseable')};
    }
    if (read.kind === 'invalid' && !read.diagnostics.some((item) => concernsKey(item, target.key))) {
      return {kind: 'refused', outcome: refusedOutcome('user-config-invalid')};
    }
    return {kind: 'proceed'};
  };

  const runWrite = async (request: ConfigEditRequest): Promise<SettingsWriteOutcome> => {
    const outcome = await writeConfigEdit(dependencies.writer, dependencies.filePath, request, {
      checkPolicy: (segments, value) => checkWritePolicy(lastPathSegment(segments), value)
    });
    if (outcome.kind === 'written') {
      return {kind: 'applied', snapshot: getSnapshot()};
    }
    if (outcome.diagnostics !== undefined && outcome.diagnostics.length > 0) {
      return {kind: 'rejected', diagnostics: outcome.diagnostics};
    }
    return refusedOutcome(outcome.reason);
  };

  const setValue = async (target: SettingTarget, value: JsonValue): Promise<SettingsWriteOutcome> => {
    const prechecked = precheck(target);
    if (prechecked.kind === 'refused') {
      return prechecked.outcome;
    }
    const policy = checkWritePolicy(target.key, value);
    if (policy.length > 0) {
      return {kind: 'rejected', diagnostics: policy};
    }
    return runWrite({kind: 'set', path: ['config', target.key], value});
  };

  const resetValue = async (target: SettingTarget): Promise<SettingsWriteOutcome> => {
    const prechecked = precheck(target);
    if (prechecked.kind === 'refused') {
      return prechecked.outcome;
    }
    return runWrite({kind: 'remove', path: ['config', target.key]});
  };

  return {getSnapshot, setValue, resetValue};
};
