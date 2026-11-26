/**
 * @file Loads the settings snapshot and tracks whether a load is in flight.
 *
 * One load runs per gateway subscription change, and each load carries an
 * abort signal so a superseded answer is dropped. A lower revision is ignored
 * as well, because a late answer must not overwrite a newer one.
 */

import {useEffect, useRef, useState} from 'react';

import type {SettingsSnapshot} from '@shared/settings/protocol';

import type {SettingsGateway} from '../ports';

const LOAD_ERROR_MESSAGE = 'Could not load settings.';

/** The result of a snapshot load. */
export type SettingsSnapshotState = {
  readonly snapshot: SettingsSnapshot | null;
  readonly isLoading: boolean;
  readonly loadError: string | null;
};

/**
 * Subscribes to the gateway and exposes the newest snapshot it delivered.
 *
 * @param gateway - The transport port used to read and watch settings.
 * @returns The latest snapshot, whether a load is pending, and the last error.
 *
 * @example
 * const {snapshot, isLoading} = useSettingsSnapshot(gateway);
 */
export const useSettingsSnapshot = (gateway: SettingsGateway): SettingsSnapshotState => {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestRevision = useRef(-1);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const next = await gateway.getSnapshot(controller.signal);
        if (controller.signal.aborted || next.revision < latestRevision.current) {
          return;
        }
        latestRevision.current = next.revision;
        setSnapshot(next);
        setLoadError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : LOAD_ERROR_MESSAGE);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    void load();
    const unsubscribe = gateway.subscribe(() => {
      void load();
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [gateway]);

  return {snapshot, isLoading, loadError};
};
