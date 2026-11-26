/**
 * @file Loads the settings snapshot and tracks whether a load is in flight.
 *
 * One load runs per gateway subscription change, and each load carries an
 * abort signal so a superseded answer is dropped. A lower revision is ignored
 * as well, because a late answer must not overwrite a newer one. Failures are
 * ordered too: whichever load was accepted last wins, so an older slow failure
 * cannot replace a newer success with an error banner. A successful load also
 * clears an error only when it started after the load that reported it, so an
 * older success cannot silence a newer failure.
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

/** State the hook needs to order one load's answer against every other. */
type LoadOrder = {
  /** The order this load started in; a higher id is newer. */
  readonly id: number;
  /** The newest id any load has started with. */
  readonly newestId: number;
  /** The newest id any load has been accepted with. */
  readonly latestAcceptedId: number;
  /** The newest revision already shown. */
  readonly latestRevision: number;
  readonly isAborted: boolean;
};

/**
 * What one settled load may change.
 *
 * An absent field means "leave it alone"; `error: null` clears a banner that a
 * previous failure left behind.
 */
type LoadSettlement = {
  /** Present only when a newer revision should replace the one on screen. */
  readonly acceptedSnapshot?: SettingsSnapshot;
  /** Whether this load counts as the newest accepted answer. */
  readonly isAccepted: boolean;
  readonly error?: string | null;
  readonly settlesLoading: boolean;
};

/**
 * Decides what a settled load may change.
 *
 * An aborted load changes nothing. A successful load is accepted even when its
 * revision is older, so a later failure cannot claim the newest answer was
 * never seen; only a newer revision is displayed. A failure is shown only when
 * no later-started load has been accepted, and the loading flag clears only
 * for the newest load, so an older answer cannot report the surface ready.
 */
const settleLoad = (
  order: LoadOrder,
  outcome: {readonly snapshot: SettingsSnapshot} | {readonly error: unknown}
): LoadSettlement => {
  if (order.isAborted) {
    return {isAccepted: false, settlesLoading: false};
  }
  const isNewestLoad = order.id === order.newestId;
  if ('snapshot' in outcome) {
    const settlement: LoadSettlement = {isAccepted: true, error: null, settlesLoading: isNewestLoad};
    // Only a newer revision replaces what is on screen; an older successful
    // answer still counts as accepted, which is what silences an earlier
    // failure that has already been superseded.
    if (outcome.snapshot.revision >= order.latestRevision) {
      return {...settlement, acceptedSnapshot: outcome.snapshot};
    }
    return settlement;
  }
  const base: LoadSettlement = {isAccepted: false, settlesLoading: isNewestLoad};
  if (order.id < order.latestAcceptedId) {
    return base;
  }
  return {
    ...base,
    error: outcome.error instanceof Error ? outcome.error.message : LOAD_ERROR_MESSAGE
  };
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
  // Loads are numbered in the order they started and in the order they were
  // accepted. A failure may only be shown when no load that started later has
  // already been accepted: otherwise an older, slower failure would replace the
  // snapshot a newer success just displayed with an error banner.
  const nextLoadId = useRef(0);
  const latestAcceptedLoadId = useRef(0);
  // The load that reported the error currently on screen. Only a success from
  // the same or a later load may clear it; an older success would otherwise
  // hide a newer reload failure and show a stale snapshot without its banner.
  const errorOwnerLoadId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();

    const applySettlement = (settlement: LoadSettlement, loadId: number): void => {
      if (settlement.isAccepted) {
        latestAcceptedLoadId.current = Math.max(latestAcceptedLoadId.current, loadId);
      }
      if (settlement.acceptedSnapshot !== undefined) {
        latestRevision.current = settlement.acceptedSnapshot.revision;
        setSnapshot(settlement.acceptedSnapshot);
      }
      if (settlement.error !== undefined) {
        if (settlement.error !== null) {
          errorOwnerLoadId.current = loadId;
          setLoadError(settlement.error);
        } else if (loadId >= errorOwnerLoadId.current) {
          setLoadError(null);
        }
      }
      if (settlement.settlesLoading) {
        setIsLoading(false);
      }
    };

    const load = async (): Promise<void> => {
      const loadId = ++nextLoadId.current;
      // Read lazily: an answer is judged against the counters as they stand
      // when it settles, not when its request was issued.
      const orderOf = (): LoadOrder => ({
        id: loadId,
        newestId: nextLoadId.current,
        latestAcceptedId: latestAcceptedLoadId.current,
        latestRevision: latestRevision.current,
        isAborted: controller.signal.aborted
      });

      try {
        const next = await gateway.getSnapshot(controller.signal);
        applySettlement(settleLoad(orderOf(), {snapshot: next}), loadId);
      } catch (error) {
        applySettlement(settleLoad(orderOf(), {error}), loadId);
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
