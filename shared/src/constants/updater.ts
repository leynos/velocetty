/** @file Shared updater action constants and action contracts. */
export const UPDATE_INSTALL = 'UPDATE_INSTALL';
export const UPDATE_AVAILABLE = 'UPDATE_AVAILABLE';

export interface UpdateInstallAction {
  type: typeof UPDATE_INSTALL;
}

export interface UpdateAvailableAction {
  type: typeof UPDATE_AVAILABLE;
  readonly version: string;
  readonly notes: string | null;
  readonly releaseUrl: string;
  readonly canInstall: boolean;
}

export type UpdateActions = UpdateInstallAction | UpdateAvailableAction;
