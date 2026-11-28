/**
 * @file The renderer-side port for reading and writing settings.
 *
 * The settings editor depends on this type, never on `ipcRenderer`, so a test
 * can drive the editor with a double and the transport stays one adapter.
 */

import type {JsonValue} from '@shared/types/json';
import type {SettingTarget, SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

/** Everything the settings editor needs from the main process. */
export type SettingsGateway = {
  /** Reads the current snapshot; the signal only abandons a superseded load. */
  readonly getSnapshot: (signal: AbortSignal) => Promise<SettingsSnapshot>;
  readonly setValue: (target: SettingTarget, value: JsonValue) => Promise<SettingsWriteOutcome>;
  readonly resetValue: (target: SettingTarget) => Promise<SettingsWriteOutcome>;
  /** Subscribes to main-process config change events. */
  readonly subscribe: (onChanged: () => void) => () => void;
};
