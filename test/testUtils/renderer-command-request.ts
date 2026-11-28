/**
 * @file Builds `RendererCommandRequest` fixtures for handler-level tests.
 *
 * Responsibilities:
 * - Provide one place that knows the request shape, so a change to it does not
 *   ripple through every handler test.
 * - Default the dispatch and signal seams to recording, never-aborting values
 *   that a test can observe or replace.
 *
 * Invariants:
 * - `args` and `invocation.args` always agree; a request never carries one
 *   without the other.
 * - The default signal never aborts, matching what the registry does for a
 *   caller that passes none.
 *
 * Usage:
 * - `createRendererCommandRequest({commandId: 'editor:search-close'})`
 *
 * Related modules:
 * - `../../lib/command-registry-handlers.ts` owns the request type.
 */
import {mock} from 'bun:test';

import {asCommandId, type CommandInvocation} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import {NEVER_ABORTS_SIGNAL, type RendererCommandRequest} from '../../lib/command-registry-handlers';
import type {HyperDispatch} from '../../typings/hyper';

export interface RendererCommandRequestOverrides {
  readonly commandId?: string;
  readonly args?: JsonValue;
  readonly dispatch?: HyperDispatch;
  readonly triggerEvent?: Event;
  readonly signal?: AbortSignal;
  readonly source?: CommandInvocation['source'];
}

/** Builds a request whose parts default to inert, overridable values. */
export const createRendererCommandRequest = (
  overrides: RendererCommandRequestOverrides = {}
): RendererCommandRequest => {
  const args = overrides.args ?? null;
  return {
    invocation: {
      id: asCommandId(overrides.commandId ?? 'test:renderer-request'),
      args,
      source: overrides.source ?? 'keybinding'
    },
    args,
    signal: overrides.signal ?? NEVER_ABORTS_SIGNAL,
    dispatch: overrides.dispatch ?? mock<HyperDispatch>(() => {}),
    triggerEvent: overrides.triggerEvent
  };
};
