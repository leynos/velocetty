/**
 * @file Shared updater action constants and action contracts.
 * Invariant: action type literals in this module are stable reducer and IPC
 * contracts and must not be renamed without coordinated migration.
 * Cross-links: consumed by app/updater.ts and lib/reducers/ui.ts.
 */
/** Action type constant for requesting update installation. */
export const UPDATE_INSTALL = 'UPDATE_INSTALL';
/** Action type constant for reporting available updates. */
export const UPDATE_AVAILABLE = 'UPDATE_AVAILABLE';

/** Action contract for install-update events. */
export interface UpdateInstallAction {
  /** Discriminates this action as `UPDATE_INSTALL`. */
  readonly type: typeof UPDATE_INSTALL;
}

/** Action contract for update-available events. */
export interface UpdateAvailableAction {
  /** Discriminates this action as `UPDATE_AVAILABLE`. */
  readonly type: typeof UPDATE_AVAILABLE;
  /** Version string of the available update. */
  readonly version: string;
  /** Release notes for the update, if provided. */
  readonly notes: string | null;
  /** URL of the release page for the update. */
  readonly releaseUrl: string;
  /** Whether the update can be installed automatically. */
  readonly canInstall: boolean;
}

/** Union type for updater actions. */
export type UpdateActions = UpdateInstallAction | UpdateAvailableAction;
