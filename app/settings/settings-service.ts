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
  asConfigFilePath,
  type ConfigEditRequest,
  type ConfigFileSystemPort,
  type ConfigWriterDependencies,
  writeConfigEdit
} from '../config/config-file-writer';
import {isKeymapConfig, isStringArray, validateConfigOptions} from '../config/json5-config';
import {observeSettingsWrite, type ConfigSpanRecorder} from '../config/config-spans';
import {isJsonObject} from '../utils/runtime-guards';
import {checkWritePolicy, isWritableSettingKey} from './settings-write-policy';
import {transportSafeValues} from './transport-values';

import type {ConfigMetrics} from '../config/config-metrics';
import type {configValidationDiagnostic} from '@shared/types/config';
import type {JsonObject, JsonValue} from '@shared/types/json';
import type {
  SettingTarget,
  SettingsFileStatus,
  SettingsSnapshot,
  SettingsWriteFailure,
  SettingsWriteOutcome
} from '@shared/settings/protocol';

import type {SettingsFileKind} from './settings-file-kind';

/** The injected dependencies of the settings service. */
export type SettingsServiceDependencies = {
  /** The active config file. */
  readonly filePath: string;
  /**
   * How the file may be treated, decided by the composition root from the
   * resolved path; the service itself reads no path rules.
   */
  readonly fileKind: SettingsFileKind;
  readonly fileSystem: ConfigFileSystemPort;
  readonly writer: ConfigWriterDependencies;
  /** The built-in defaults, as they appear in `config-default.json`. */
  readonly defaults: JsonObject;
  readonly getDefaultProfileName: () => string;
  /** The write observer: one span, the outcome counters, and one bounded line. */
  readonly spans?: ConfigSpanRecorder;
  readonly metrics?: Pick<ConfigMetrics, 'increment'>;
  readonly log?: (message: string) => void;
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

/** One top-level field check: a diagnostic, or null when the field is valid. */
type RawFieldCheck = (parsed: JsonObject) => configValidationDiagnostic | null;

const configFieldProblem: RawFieldCheck = (parsed) =>
  Object.hasOwn(parsed, 'config') && !isJsonObject(parsed.config)
    ? diagnostic('/config', 'Expected `config` to be an object.', 'Set `config` to an object value.')
    : null;

const stringArrayProblem =
  (field: 'plugins' | 'localPlugins'): RawFieldCheck =>
  (parsed) =>
    Object.hasOwn(parsed, field) && !isStringArray(parsed[field])
      ? diagnostic(
          `/${field}`,
          `Expected \`${field}\` to be an array of strings when present.`,
          `Set \`${field}\` to an array of plugin names, for example ['plugin-name'].`
        )
      : null;

const keymapFieldProblem: RawFieldCheck = (parsed) =>
  Object.hasOwn(parsed, 'keymaps') && !isKeymapConfig(parsed.keymaps)
    ? diagnostic(
        '/keymaps',
        'Expected `keymaps` values to be strings or string arrays when present.',
        'Set `keymaps` entries to keybinding strings or string arrays.'
      )
    : null;

const RAW_FIELD_CHECKS: readonly RawFieldCheck[] = [
  configFieldProblem,
  stringArrayProblem('plugins'),
  stringArrayProblem('localPlugins'),
  keymapFieldProblem
];

/** Every top-level field the load path checks, in one diagnostic list. */
const topLevelDiagnostics = (parsed: JsonValue): readonly configValidationDiagnostic[] => {
  if (!isJsonObject(parsed)) {
    return [diagnostic('/', 'Expected config payload to be an object.', 'Set the root config value to an object.')];
  }
  const problems: configValidationDiagnostic[] = [];
  for (const check of RAW_FIELD_CHECKS) {
    const problem = check(parsed);
    if (problem !== null) {
      problems.push(problem);
    }
  }
  return problems;
};

/** The complete diagnostic list, including every `config` schema issue. */
const diagnosticsOf = (parsed: JsonValue): readonly configValidationDiagnostic[] => {
  const problems = [...topLevelDiagnostics(parsed)];
  if (isJsonObject(parsed) && isJsonObject(parsed.config)) {
    problems.push(...validateConfigOptions(parsed.config));
  }
  return problems;
};

/** The read result for a file that exists but cannot be read or stat'ed. */
const unreadableFile = (): FileRead => ({
  kind: 'unparseable',
  diagnostics: [diagnostic('/', 'The config file could not be read.', 'Check the file permissions.')]
});

const readConfigFile = (dependencies: SettingsServiceDependencies): FileRead => {
  const filePath = asConfigFilePath(dependencies.filePath);
  let isPresent: boolean;
  try {
    isPresent = dependencies.fileSystem.stat(filePath) !== null;
  } catch {
    // `getSnapshot` must answer with a file state, not throw: the renderer
    // needs the tab and its diagnostic, and a `stat` failure such as EACCES is
    // the same user-visible condition as an unreadable file.
    return unreadableFile();
  }
  if (!isPresent) {
    return {kind: 'missing'};
  }
  let text: string;
  try {
    text = dependencies.fileSystem.readText(filePath);
  } catch {
    return unreadableFile();
  }
  let parsed: JsonValue;
  try {
    // SAFETY: JSON5.parse produces only JSON5 primitives, arrays, and objects.
    parsed = JSON5.parse(text) as JsonValue;
  } catch (error) {
    return {kind: 'unparseable', diagnostics: parseDiagnostics(error)};
  }
  const userValues = userValuesOf(parsed);
  if (dependencies.fileKind === 'legacy-json') {
    return {kind: 'legacy', userValues};
  }
  // The load path validates the whole raw config, including the top-level
  // plugin and keymap fields. Report every problem here too: returning only the
  // first would hide a key the user is allowed to repair.
  const diagnostics = diagnosticsOf(parsed);
  if (diagnostics.length > 0) {
    return {kind: 'invalid', userValues, diagnostics};
  }
  return {kind: 'ok', userValues};
};

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
 * @param dependencies - File-system, writer, defaults, and the write observer.
 * @returns The service used by the IPC handlers.
 */
export const createSettingsService = (dependencies: SettingsServiceDependencies): SettingsService => {
  const snapshotOf = (read: FileRead): SettingsSnapshot => ({
    revision: dependencies.writer.currentRevision(),
    filePath: dependencies.filePath,
    fileStatus: statusOf(read),
    userValues: 'userValues' in read ? transportSafeValues(read.userValues) : {},
    defaultValues: coreDefaults(dependencies.defaults),
    profileOverriddenKeys: profileOverriddenKeys(
      'userValues' in read ? read.userValues : {},
      dependencies.getDefaultProfileName()
    )
  });

  const getSnapshot = (): SettingsSnapshot => snapshotOf(readConfigFile(dependencies));

  const precheck = (target: SettingTarget): Precheck => {
    if (dependencies.fileKind === 'legacy-json') {
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
      return {kind: 'applied', snapshot: getSnapshot(), durability: outcome.durability};
    }
    if (outcome.diagnostics !== undefined && outcome.diagnostics.length > 0) {
      return {kind: 'rejected', diagnostics: outcome.diagnostics};
    }
    return refusedOutcome(outcome.reason);
  };

  /** The write at the tail of the queue, or `undefined` when the queue is idle. */
  let pendingWrite: Promise<void> | undefined;

  /**
   * Runs one write after every write already submitted, preserving order.
   *
   * `writeConfigEdit` retries a busy file with a backoff, so a later write
   * could otherwise reach the file first and an earlier retry then overwrite
   * its value. A write submitted to an idle queue starts immediately, so the
   * writer's synchronous critical section is unchanged in the common case.
   */
  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
    const started = pendingWrite === undefined ? task() : pendingWrite.then(task);
    // A refused write releases the queue just as an applied one does: the next
    // submission still runs, and the refusing caller sees its own outcome.
    const settled = (async () => {
      try {
        await started;
      } catch {
        // The outcome is already reported through `started`; the queue only
        // needs to know the write finished.
      }
    })();
    pendingWrite = settled;
    // Only the last write releases the queue; while a later write is waiting,
    // it still starts after this one settles.
    void settled.then(() => {
      if (pendingWrite === settled) {
        pendingWrite = undefined;
      }
    });
    return started;
  };

  const setValue = (target: SettingTarget, value: JsonValue): Promise<SettingsWriteOutcome> =>
    enqueueWrite(() =>
      observeSettingsWrite(dependencies, async () => {
        const prechecked = precheck(target);
        if (prechecked.kind === 'refused') {
          return prechecked.outcome;
        }
        const policy = checkWritePolicy(target.key, value);
        if (policy.length > 0) {
          return {kind: 'rejected', diagnostics: policy};
        }
        return runWrite({kind: 'set', path: ['config', target.key], value});
      })
    );

  const resetValue = (target: SettingTarget): Promise<SettingsWriteOutcome> =>
    enqueueWrite(() =>
      observeSettingsWrite(dependencies, async () => {
        const prechecked = precheck(target);
        if (prechecked.kind === 'refused') {
          return prechecked.outcome;
        }
        return runWrite({kind: 'remove', path: ['config', target.key]});
      })
    );

  return {getSnapshot, setValue, resetValue};
};
