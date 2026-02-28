/** @file App-local branded identifier casts aligned with shared type contracts. */
import type {ProfileId, RendererUid, SessionId} from '@shared/types/common';
import type {CommandId} from '@shared/types/commands';

/** Casts a raw profile identifier to the shared branded profile type. */
export const asProfileId = (value: string): ProfileId => value as ProfileId;

/** Casts a raw session identifier to the shared branded session type. */
export const asSessionId = (value: string): SessionId => value as SessionId;
/** Casts a raw command identifier to the shared branded command type. */
export const asCommandId = (value: string): CommandId => value as CommandId;
/** Casts a raw renderer identifier to the shared branded renderer type. */
export const asRendererUid = (value: string): RendererUid => value as RendererUid;
