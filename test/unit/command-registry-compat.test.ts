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

type CommandRegistryCompatHarness = typeof import('../../lib/command-registry') & {
  cleanup: () => void;
  focusActiveTermMock: ReturnType<typeof mock<() => void>>;
  invokeMock: ReturnType<typeof mock<(channel: string) => Promise<Record<string, string[]> | CommandDefinition[]>>>;
  setDecoratedKeymaps: (nextKeymaps: Record<string, string[]>) => void;
  setRuntimeCommands: (nextCommands: CommandDefinition[]) => void;
};

let moduleInstanceCounter = 0;

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
  moduleInstanceCounter += 1;
  const {createCommandRegistryModule, closeSearchAction} = await import(
    `../../lib/command-registry.ts?command_registry_compat=${moduleInstanceCounter}`
  );

  return {
    ...createCommandRegistryModule({
      closeSearch: closeSearchAction,
      focusActiveTerm: focusActiveTermMock,
      transport: {
        invoke: invokeMock
      }
    }),
    // No teardown needed: DI means no module-level state was mutated.
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

test('registerCommandHandlers ignores undefined input without mutating the registry', async () => {
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
});

test('compatibility aliases mirror the primary command-registry APIs', async () => {
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
});

test('legacy search-close handler dispatches closeSearch and focuses the active terminal', async () => {
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
});

test('legacy search-close handler does not dispatch when session search is inactive', async () => {
  const harness = await createCommandRegistryCompatHarness();
  try {
    const dispatch = mock(() => {});
    const innerDispatch = mock(() => {});
    const keyEvent: {catched: boolean} = {catched: true};

    harness.getCommandHandler('editor:search-close')?.(keyEvent, dispatch as unknown as never);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatchedThunk = dispatch.mock.calls[0]?.[0];
    if (typeof dispatchedThunk !== 'function') {
      throw new Error('Expected the legacy search-close handler to dispatch a thunk');
    }

    // Session for the active uid has no search flag — thunk should not
    // dispatch SESSION_SEARCH and should set catched to false instead.
    dispatchedThunk(innerDispatch as never, () => ({
      sessions: {
        activeUid: 'active-session',
        sessions: {
          'active-session': {}
        }
      }
    }));

    expect(innerDispatch).not.toHaveBeenCalled();
    expect(keyEvent.catched).toBe(false);
    expect(harness.focusActiveTermMock).toHaveBeenCalledTimes(1);
  } finally {
    harness.cleanup();
  }
});

test('legacy search-close handler targets the uid provided by state rather than a hardcoded value', async () => {
  const harness = await createCommandRegistryCompatHarness();
  try {
    const dispatch = mock(() => {});
    const innerDispatch = mock(() => {});

    harness.getCommandHandler('editor:search-close')?.('event-payload', dispatch as unknown as never);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatchedThunk = dispatch.mock.calls[0]?.[0];
    if (typeof dispatchedThunk !== 'function') {
      throw new Error('Expected the legacy search-close handler to dispatch a thunk');
    }

    // Use a different active uid with search: true to confirm the thunk
    // reads activeUid from state rather than using any hardcoded value.
    dispatchedThunk(innerDispatch as never, () => ({
      sessions: {
        activeUid: 'other-uid',
        sessions: {
          'other-uid': {
            search: true
          }
        }
      }
    }));

    expect(innerDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SESSION_SEARCH,
        uid: 'other-uid',
        value: false
      })
    );
    expect(harness.focusActiveTermMock).toHaveBeenCalledTimes(1);
  } finally {
    harness.cleanup();
  }
});
