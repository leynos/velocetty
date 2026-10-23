/**
 * @file App-local branded identifier casts aligned with shared type contracts.
 *
 * The brands themselves live in `@shared/types/*` and arrive as types. The
 * constructors stay here because `app/` compiles to CommonJS under `dist/app`,
 * where a bare `@shared/*` specifier has nothing to resolve against at runtime.
 * See the alias rule in `docs/developers-guide.md`.
 */

import type {ProfileId, RendererUid, SessionId} from '@shared/types/common';
import type {CommandId} from '@shared/types/commands';

/** Casts a raw profile identifier to the shared branded profile type. */
// SAFETY: Profile names remain strings at runtime; the brand documents the shared boundary.
export const asProfileId = (value: string): ProfileId => value as ProfileId;

/** Casts a raw session identifier to the shared branded session type. */
// SAFETY: Session identifiers remain strings at runtime; the brand documents the shared boundary.
export const asSessionId = (value: string): SessionId => value as SessionId;

/** Casts a raw renderer identifier to the shared branded renderer type. */
// SAFETY: Renderer identifiers remain strings at runtime; the brand documents the shared boundary.
export const asRendererUid = (value: string): RendererUid => value as RendererUid;

/**
 * Casts a raw command identifier to the shared branded command type.
 *
 * Accepts an already-branded value so the menu executors can re-assert the
 * identity of a command they received as `CommandId`.
 */
// SAFETY: Command identifiers remain strings at runtime; the brand documents the shared boundary.
export const asCommandId = (value: string | CommandId): CommandId => value as CommandId;
