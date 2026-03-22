/**
 * @file Verifies the compatibility-alias and legacy-handler behaviour exposed
 * by the shared command-registry module.
 *
 * Responsibilities:
 * - assert that legacy alias exports remain wired to the primary
 *   command-registry APIs
 * - verify `registerCommandHandlers(...)` ignores undefined input without
 *   mutating the existing registry
 * - confirm the legacy `editor:search-close` handler still dispatches the
 *   expected close-search action and restores terminal focus
 *
 * Invariants:
 * - compatibility aliases continue to reference the same callable
 *   implementations as the primary exports
 * - the built-in legacy handler remains registered throughout the suite
 * - each test runs against an isolated command-registry module instance and a
 *   reset transport mock state
 *
 * Usage:
 * - run this module directly with
 *   `bun test test/unit/command-registry-compat.test.ts`
 * - each test installs its own IPC transport mock and temporary
 *   `window.focusActiveTerm` shim before importing the module under test
 *
 * Related modules:
 * - `../../lib/command-registry.ts` implements the compatibility aliases and
 *   legacy handlers under test
 * - `./command-registry.test.ts` covers the core keymap and CRUD behaviour for
 *   the same module
 * - `./ensure-directory-path.test.ts` is the companion example for this
 *   richer test-module header format
 */
import {expect, mock, test} from 'bun:test';
import {SESSION_SEARCH} from '@shared/constants/sessions';
import type {CommandDefinition} from '@shared/types/commands';

import {createCommandRegistryModule} from '../../lib/command-registry';

type CommandRegistryCompatHarness = typeof import('../../lib/command-registry') & {
  cleanup: () => void;
  focusActiveTermMock: ReturnType<typeof mock<() => void>>;
  invokeMock: ReturnType<typeof mock<(channel: string) => Promise<Record<string, string[]> | CommandDefinition[]>>>;
  setDecoratedKeymaps: (nextKeymaps: Record<string, string[]>) => void;
  setRuntimeCommands: (nextCommands: CommandDefinition[]) => void;
};

const createCommandRegistryCompatHarness = async (): Promise<CommandRegistryCompatHarness> => {
  let decoratedKeymaps: Record<string, string[]> = {};
  let runtimeCommands: CommandDefinition[] = [];
  const invokeMock = mock(async (channel: string) => {
    if (channel === 'getRuntimePluginCommands') {
      return runtimeCommands;
    }
    if (channel === 'getDecoratedKeymaps') {
      return decoratedKeymaps;
    }
    throw new Error(`Unexpected IPC channel: ${channel}`);
  });
  const focusActiveTermMock = mock(() => {});

  return {
    ...createCommandRegistryModule({
      focusActiveTerm: focusActiveTermMock,
      transport: {
        invoke: invokeMock
      }
    }),
    cleanup: () => {},
    focusActiveTermMock,
    invokeMock,
    setDecoratedKeymaps: (nextKeymaps) => {
      decoratedKeymaps = nextKeymaps;
    },
    setRuntimeCommands: (nextCommands) => {
      runtimeCommands = nextCommands;
    }
  };
};

test('registerCommandHandlers ignores undefined input without mutating the registry', () => {
  return (async () => {
    const harness = await createCommandRegistryCompatHarness();
    try {
      const registryBeforeUndefinedCall = harness.list().map((command) => ({
        id: command.id,
        handler: harness.getCommandHandler(command.id)
      }));

      harness.registerCommandHandlers(undefined);

      const registryAfterUndefinedCall = harness.list().map((command) => ({
        id: command.id,
        handler: harness.getCommandHandler(command.id)
      }));

      expect(registryAfterUndefinedCall).toStrictEqual(registryBeforeUndefinedCall);
    } finally {
      harness.cleanup();
    }
  })();
});

test('compatibility aliases mirror the primary command-registry APIs', () => {
  return (async () => {
    const harness = await createCommandRegistryCompatHarness();
    try {
      expect(harness.registerCommand).toBe(harness.register);
      expect(harness.createCommand).toBe(harness.register);
      expect(harness.updateCommand).toBe(harness.update);
      expect(harness.replaceCommand).toBe(harness.update);
      expect(harness.removeCommand).toBe(harness.remove);
      expect(harness.deleteCommand).toBe(harness.remove);
      expect(harness.getCommand).toBe(harness.get);
      expect(harness.getCommandDefinition).toBe(harness.get);
      expect(harness.listCommands).toBe(harness.list);
      expect(harness.enumerateCommands).toBe(harness.list);
      expect(harness.hasCommand).toBe(harness.has);
      expect(harness.hasCommandDefinition).toBe(harness.has);
      expect(harness.validateCommandArgs).toBe(harness.validateArgs);
      expect(harness.validateCommandArgsFor).toBe(harness.validateArgs);
    } finally {
      harness.cleanup();
    }
  })();
});

test('legacy search-close handler dispatches closeSearch and focuses the active terminal', () => {
  return (async () => {
    const harness = await createCommandRegistryCompatHarness();
    try {
      const dispatch = mock(() => {});
      const innerDispatch = mock(() => {});

      harness.getCommandHandler('editor:search-close')?.('event-payload', dispatch as unknown as never);

      expect(dispatch).toHaveBeenCalledTimes(1);
      const dispatchedThunk = dispatch.mock.calls[0]?.[0];
      expect(dispatchedThunk).toBeFunction();
      if (typeof dispatchedThunk !== 'function') {
        throw new Error('Expected the legacy search-close handler to dispatch a thunk');
      }

      dispatchedThunk(innerDispatch as never, () => ({
        sessions: {
          activeUid: 'active-session',
          sessions: {
            'active-session': {
              search: true
            }
          }
        }
      }));

      expect(innerDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SESSION_SEARCH,
          uid: 'active-session',
          value: false
        })
      );
      expect(harness.focusActiveTermMock).toHaveBeenCalledTimes(1);
    } finally {
      harness.cleanup();
    }
  })();
});
