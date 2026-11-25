/**
 * @file `INV-SAME-PATH`: every source takes the same route to a command.
 *
 * The requirement is that a keybinding, a UI control, and a plugin call do not
 * merely reach the same handler — they produce the same machine trace and the
 * same `UI_COMMAND_EXEC` action, differing only in `source`. Testing each
 * source separately would not show that.
 *
 * The suite drives the real dispatcher, the real schema validator, the real
 * registry module, and the real Redux execution gate. Only the transport and
 * the clock-free handler bodies are fakes.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/convergence.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/dispatcher.ts`
 * - `../../../lib/command-dispatch/compose.ts`
 */
import {describe, expect, test} from 'bun:test';

import {asCommandId, type CommandInvocation, type CommandInvocationSource} from '@shared/types/commands';
import {UI_COMMAND_EXEC} from '@shared/constants/ui';
import type {JsonValue} from '@shared/types/json';
import {createCommandDispatcher} from '../../../lib/command-dispatch/dispatcher';
import type {MachineEvent} from '../../../lib/command-dispatch/policy/invocation-machine';
import {createContextKeyEnablement} from '../../../lib/command-dispatch/adapters/context-key-enablement';
import {
  createReduxExecutionGate,
  type CommandExecutionAction
} from '../../../lib/command-dispatch/adapters/redux-execution-gate';
import {createRegistryCatalogue} from '../../../lib/command-dispatch/adapters/registry-catalogue';
import {
  createRendererExecutor,
  type RendererExecutionContext
} from '../../../lib/command-dispatch/adapters/renderer-executor';
import {createPluginCommandApi} from '../../../lib/command-dispatch/inbound/plugin-api';
import {createKeybindingBinder, type MousetrapLike} from '../../../lib/command-dispatch/inbound/keybinding';
import {createContextKeyService} from '../../../lib/context-key-service';
import {closeSearchAction, SEARCH_CLOSE_COMMAND_ID} from '../../../lib/commands/search-close';
import {createCommandRegistryModule} from '../../../lib/command-registry';
import type {CommandDefinition} from '@shared/types/commands';
import {fakeDefinition} from '../../testUtils/command-dispatcher-fakes';

const CAPTURE = 'test:convergence:capture';
const HOST_FROM_KEYMAP = 'tab:new';

/** The keymap every workspace binds, so each source can reach each command. */
const KEYMAP = {
  [HOST_FROM_KEYMAP]: 'ctrl+t',
  [SEARCH_CLOSE_COMMAND_ID]: 'esc',
  [CAPTURE]: 'ctrl+alt+c'
} satisfies Record<string, string>;

/** The event shape the binder hands a bound callback. */
type AnyKeyEvent = Parameters<Parameters<MousetrapLike['bind']>[1]>[0];

interface Trace {
  readonly actions: CommandExecutionAction[];
  readonly events: MachineEvent[];
  readonly handlerArgs: JsonValue[];
}

/**
 * Builds one workspace around a fresh registry module, so each source is driven
 * through the same catalogue, gate, and executor the renderer uses.
 */
const createWorkspace = () => {
  const registryModule = createCommandRegistryModule({
    closeSearch: closeSearchAction,
    focusActiveTerm: () => {},
    // SAFETY: the workspace supplies the keymap through the binder, so the
    // registry's own lookup is never reached here.
    transport: {invoke: (async () => []) as never}
  });

  const bound = new Set<string>([HOST_FROM_KEYMAP]);
  const hostEmissions: string[] = [];
  const actions: CommandExecutionAction[] = [];
  const events: MachineEvent[] = [];
  const handlerArgs: JsonValue[] = [];

  registryModule.register(fakeDefinition(CAPTURE, {argsSchema: {type: ['object', 'null']}}));
  // A legacy handler, which is what a plugin registers; the registry adapts it
  // to the request shape.
  registryModule.registerCommandHandlers({
    [CAPTURE]: (event, dispatch) => {
      handlerArgs.push(event === undefined ? null : 'event');
      void dispatch;
    }
  });

  const catalogue = createRegistryCatalogue({
    registry: {
      get: registryModule.get,
      validateArgs: registryModule.validateArgs,
      validateResult: registryModule.validateResult
    },
    getBoundKeymapCommandIds: () => bound
  });

  const gate = createReduxExecutionGate((action) => {
    actions.push(action);
    // The real store runs the effect through the `effects` middleware; this
    // stands in for that middleware so the trace stays observable.
    action.effect();
    return action;
  });

  const executor = createRendererExecutor({
    getHandler: registryModule.getCommandHandler,
    // SAFETY: no renderer handler in this suite dispatches; the executor only
    // forwards this function into the request.
    dispatch: (() => {}) as never,
    emitHostCommand: (id) => {
      hostEmissions.push(id);
    }
  });

  const dispatcher = createCommandDispatcher<RendererExecutionContext>({
    catalogue,
    enablement: createContextKeyEnablement(createContextKeyService()),
    gate,
    executor,
    logger: {debug: () => {}, warn: () => {}},
    trace: (event) => events.push(event)
  });

  const mousetrap = (() => {
    const bindings = new Map<string, (event: AnyKeyEvent) => void>();
    const instance: MousetrapLike = {
      bind: (keys, callback) => {
        bindings.set(keys, callback);
      },
      reset: () => bindings.clear()
    };
    return {instance, bindings};
  })();

  const binder = createKeybindingBinder({
    dispatcher,
    keymap: {
      getRegisteredKeys: async () => Object.fromEntries(Object.entries(KEYMAP).map(([id, keys]) => [keys, id]))
    },
    getMousetrap: () => mousetrap.instance,
    logger: {debug: () => {}, warn: () => {}},
    onSnapshot: () => {}
  });

  const pluginApi = createPluginCommandApi(dispatcher);

  return {actions, events, handlerArgs, hostEmissions, mousetrap, binder, dispatcher, pluginApi, registryModule};
};

type Workspace = ReturnType<typeof createWorkspace>;

/** Runs one command from one source and returns what the workspace observed. */
const runFromSource = async (
  workspace: Workspace,
  source: CommandInvocationSource,
  commandId: string,
  args: JsonValue
): Promise<Trace> => {
  const actionStart = workspace.actions.length;
  const eventStart = workspace.events.length;
  const handlerStart = workspace.handlerArgs.length;

  const invocation: CommandInvocation = {id: asCommandId(commandId), args, source};

  if (source === 'keybinding') {
    await workspace.binder.reload();
    const shortcut = Object.entries(KEYMAP).find(([id]) => id === commandId)?.[1];
    if (!shortcut) {
      throw new Error(`No shortcut is bound to ${commandId}`);
    }
    const handler = workspace.mousetrap.bindings.get(shortcut);
    if (!handler) {
      throw new Error(`Expected ${shortcut} to be bound`);
    }
    // SAFETY: `catched` is the only extra field the binder reads, and a plain
    // `Event` is otherwise structurally what it needs.
    handler(Object.assign(new Event('keydown', {cancelable: true}), {catched: false}) as AnyKeyEvent);
  } else if (source === 'plugin') {
    await workspace.pluginApi(commandId, args);
  } else {
    await workspace.dispatcher.invoke(invocation, {}, {triggerEvent: undefined});
  }

  // Let a renderer handler's microtask settle.
  await Promise.resolve();
  await Promise.resolve();

  return {
    actions: workspace.actions.slice(actionStart),
    events: workspace.events.slice(eventStart),
    handlerArgs: workspace.handlerArgs.slice(handlerStart)
  };
};

/** The `UI_COMMAND_EXEC` actions with the source removed, for comparison. */
const comparableActions = (actions: CommandExecutionAction[]) =>
  actions.map((action) => ({type: action.type, command: action.command, args: action.args}));

const SOURCES: {source: CommandInvocationSource; label: string}[] = [
  {source: 'keybinding', label: 'a keybinding'},
  {source: 'ui', label: 'a UI control'},
  {source: 'plugin', label: 'a plugin'}
];

describe('INV-SAME-PATH', () => {
  test.each(SOURCES)('a renderer command from $label produces one machine trace and one action', async ({source}) => {
    const workspace = createWorkspace();
    // `null` arguments are the one input every source can express: a
    // keybinding has no way to carry arguments, so comparing sources on a
    // populated payload would compare their transports, not their path.
    const trace = await runFromSource(workspace, source, CAPTURE, null);

    expect(trace.actions).toHaveLength(1);
    expect(trace.actions[0]?.type).toBe(UI_COMMAND_EXEC);
    expect(trace.actions[0]?.source).toBe(source);
    expect(trace.actions[0]?.args).toBeNull();

    // Gate order is the same for every source: four admissions, the gate, the
    // handler, then settlement.
    expect(trace.events.map((event) => event.kind)).toEqual([
      'gatePassed',
      'gatePassed',
      'gatePassed',
      'gatePassed',
      'gateRan',
      'handlerFulfilled'
    ]);
  });

  test.each(SOURCES)('a keymap host command from $label is emitted once and dispatches one action', async ({
    source
  }) => {
    const workspace = createWorkspace();
    const trace = await runFromSource(workspace, source, HOST_FROM_KEYMAP, null);

    expect(workspace.hostEmissions).toEqual([asCommandId(HOST_FROM_KEYMAP)]);
    expect(trace.actions).toHaveLength(1);
    expect(trace.actions[0]?.source).toBe(source);
    expect(trace.events.at(-1)?.kind).toBe('hostEmitted');
  });

  test.each(SOURCES)('escape, bound with no arguments, closes the search from $label', async ({source}) => {
    const workspace = createWorkspace();
    const trace = await runFromSource(workspace, source, SEARCH_CLOSE_COMMAND_ID, null);

    expect(trace.actions).toHaveLength(1);
    expect(trace.actions[0]?.args).toBeNull();
    expect(trace.events.at(-1)?.kind).toBe('handlerFulfilled');
  });

  test('the three sources differ only in the recorded source', async () => {
    const traces: CommandExecutionAction[][] = [];
    for (const {source} of SOURCES) {
      const workspace = createWorkspace();
      const trace = await runFromSource(workspace, source, CAPTURE, null);
      traces.push(trace.actions);
    }

    const [keybindingTrace = [], uiTrace = [], pluginTrace = []] = traces;
    const keybindingActions = comparableActions(keybindingTrace);
    expect(comparableActions(uiTrace)).toEqual(keybindingActions);
    expect(comparableActions(pluginTrace)).toEqual(keybindingActions);
  });

  test('the sources that can carry arguments deliver them unchanged', async () => {
    for (const source of ['ui', 'plugin'] as const) {
      const workspace = createWorkspace();
      const trace = await runFromSource(workspace, source, CAPTURE, {uid: 's1'});
      expect(trace.actions[0]?.args).toEqual({uid: 's1'});
    }
  });

  test('a plugin cannot claim another source', async () => {
    const workspace = createWorkspace();
    const trace = await runFromSource(workspace, 'plugin', CAPTURE, null);

    expect(trace.actions[0]?.source).toBe('plugin');
  });
});
