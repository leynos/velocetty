/** @file App-local branded identifier casts aligned with shared type contracts. */
import type {ProfileId, SessionId} from '@shared/types/common';

/** Casts a raw profile identifier to the shared branded profile type. */
export const asProfileId = (value: string): ProfileId => value as ProfileId;

/** Casts a raw session identifier to the shared branded session type. */
export const asSessionId = (value: string): SessionId => value as SessionId;
