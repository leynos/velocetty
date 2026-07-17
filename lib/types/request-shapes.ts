/** @file Shared request-shape types used across bootstrap and action layers. */

/** Optional context for a new-session or split request. */
export type SplitRequestParams = {
  /** Session to split from, or use as the source of context, defaulting to the active session. */
  activeUid?: string;
  /** Profile to launch the new session with, defaulting to the source session's profile. */
  profile?: string;
};
