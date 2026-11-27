/**
 * @file Snapshots and a hand-resolved gateway for the settings hooks.
 *
 * Resolving each load by hand is what makes a late answer observable: the test
 * chooses the order the promises settle in, rather than the transport.
 */
import type {SettingsGateway} from '../../lib/settings/ports';
import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

export const CONFIG_PATH = '/home/me/.config/Velocetty/config.json5';
export const NO_CHANGE = () => {};

export const snapshotOf = (revision: number, userValues: Readonly<Record<string, number>> = {}): SettingsSnapshot => ({
  revision,
  filePath: CONFIG_PATH,
  fileStatus: {kind: 'ok'},
  userValues,
  defaultValues: {},
  profileOverriddenKeys: []
});

export type PendingLoad = {
  readonly resolve: (snapshot: SettingsSnapshot) => void;
  readonly reject: (error: Error) => void;
};

/** Builds a gateway whose loads the test resolves by hand. */
export const createRecordingGateway = () => {
  const loads: PendingLoad[] = [];
  let onChange: () => void = NO_CHANGE;

  const gateway: SettingsGateway = {
    getSnapshot: () =>
      new Promise<SettingsSnapshot>((resolve, reject) => {
        loads.push({resolve, reject});
      }),
    resetValue: async (): Promise<SettingsWriteOutcome> => ({
      kind: 'failed',
      reason: 'io-error'
    }),
    setValue: async (): Promise<SettingsWriteOutcome> => ({kind: 'failed', reason: 'io-error'}),
    subscribe: (callback) => {
      onChange = callback;
      return () => {
        onChange = NO_CHANGE;
      };
    }
  };

  return {gateway, loads, notifyChange: () => onChange()};
};
