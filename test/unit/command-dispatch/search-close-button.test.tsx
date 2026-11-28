/**
 * @file The search box close button runs `editor:search-close`.
 *
 * This is the first UI control routed through the dispatcher, and the plan's
 * acceptance evidence for it: clicking close must invoke the command with the
 * session's `uid`, not call a bespoke teardown.
 *
 * `lib/command-dispatch/inbound/search-close.ts` holds the wiring the real
 * `Term` uses, so this suite exercises that exact function rather than a copy
 * of it.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/search-close-button.test.tsx`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/inbound/search-close.ts`
 * - `../../../lib/components/search-box.tsx`
 */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {afterEach, beforeEach, expect, test} from 'bun:test';

import {asCommandId, type CommandInvocation, type CommandResult} from '@shared/types/commands';
import type {RendererDispatcherBundle} from '../../../lib/command-dispatch/compose';
import {requestSearchClose} from '../../../lib/command-dispatch/inbound/search-close';
import {SEARCH_CLOSE_COMMAND_ID} from '../../../lib/commands/search-close';
import {setupHappyDom} from '../../testUtils/happy-dom';

interface RecordedCall {
  readonly invocation: CommandInvocation;
}

/** A bundle whose dispatcher records what it was asked to run. */
const createRecordingBundle = (calls: RecordedCall[]): RendererDispatcherBundle => {
  const dispatcher = {
    check: () => ({admitted: true}),
    invoke: async (invocation: CommandInvocation): Promise<CommandResult> => {
      calls.push({invocation});
      return {status: 'ok'};
    }
  };
  return {
    dispatcher,
    keybindings: {
      reload: async () => {},
      reset: () => {}
    },
    invokeCommand: async () => ({status: 'ok'})
  };
};

let cleanupHappyDom: (() => void) | null = null;

beforeEach(async () => {
  cleanupHappyDom = await setupHappyDom();
});

afterEach(() => {
  cleanupHappyDom?.();
  cleanupHappyDom = null;
});

test('the close button invokes editor:search-close with the session uid', async () => {
  const calls: RecordedCall[] = [];
  const bundle = createRecordingBundle(calls);
  let fallbackCalls = 0;

  const onClick = () =>
    requestSearchClose(bundle, 'session-7', () => {
      fallbackCalls += 1;
    });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement('button', {type: 'button', onClick}, 'close'));
  });

  const button = container.querySelector('button');
  if (!button) {
    throw new Error('Expected a close button');
  }

  await act(async () => {
    button.click();
  });

  expect(fallbackCalls).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.invocation).toEqual({
    id: asCommandId(SEARCH_CLOSE_COMMAND_ID),
    args: {uid: 'session-7'},
    source: 'ui'
  });

  await act(async () => {
    root.unmount();
  });
});

test('without a dispatcher the button still tears the search box down', () => {
  let fallbackCalls = 0;

  requestSearchClose(undefined, 'session-7', () => {
    fallbackCalls += 1;
  });

  expect(fallbackCalls).toBe(1);
});
