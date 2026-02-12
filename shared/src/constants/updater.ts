/** @file Shared updater action constants and action contracts. */
/** Action type constant for requesting update installation. */
export const UPDATE_INSTALL = 'UPDATE_INSTALL';
/** Action type constant for reporting available updates. */
export const UPDATE_AVAILABLE = 'UPDATE_AVAILABLE';

/** Action contract for install-update events. */
export interface UpdateInstallAction {
  readonly type: typeof UPDATE_INSTALL;
}

/** Action contract for update-available events. */
export interface UpdateAvailableAction {
  readonly type: typeof UPDATE_AVAILABLE;
  readonly version: string;
  readonly notes: string | null;
  readonly releaseUrl: string;
  readonly canInstall: boolean;
}

/** Union type for updater actions. */
export type UpdateActions = UpdateInstallAction | UpdateAvailableAction;
