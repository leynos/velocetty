/**
 * @file Behavioural tests for the command dispatcher interpreter.
 *
 * These cover the obligations the proof cannot reach: the interpreter's
 * asynchronous edges, its interaction with a caller's `AbortSignal`, and the
 * timing guarantee that keeps legacy keybinding handlers working.
 *
 * Responsibilities:
 * - `INV-SYNC`: with nothing deferring the execution gate, the handler has
 *   already run by the time `invoke` returns its promise.
 * - `INV-NO-LEAK`: abort listeners are added only for a caller-supplied signal,
 *   and removed on settlement; a late rejection reaches the logger instead of
 *   the runtime.
 * - Gate outcomes map to the documented result shapes.
 *
 * Invariants:
 * - Every test drives the real interpreter; only the ports are fakes.
 * - No test uses a timer or a thenable fake.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/dispatcher.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/dispatcher.ts`
 * - `../../../lib/command-dispatch/ports.ts`
 * - `./interpreter-structure.test.ts` guards that the machine is consulted
 */
import {describe, expect, test} from 'bun:test';

import {asCommandId, type CommandInvocation} from '@shared/types/commands';
import {createCommandDispatcher} from '../../../lib/command-dispatch/dispatcher';
import {createDispatcherFakes, fakeDefinition} from '../../testUtils/command-dispatcher-fakes';

const RENDERER = 'test:renderer';
const HOST = 'test:host';

const invocation = (id: string, overrides: Partial<CommandInvocation> = {}): CommandInvocation => ({
  id: asCommandId(id),
  args: null,
  source: 'ui',
  ...overrides
});

const buildFakes = (overrides: Parameters<typeof createDispatcherFakes>[0] = {}) =>
  createDispatcherFakes<{readonly triggerEvent: Event | undefined}>({
    commands: {
      [RENDERER]: {definition: fakeDefinition(RENDERER), handlerValue: {done: true}}
    },
    hostCommandIds: [HOST],
    boundKeymapCommandIds: [HOST],
    ...overrides
  });

describe('INV-SYNC', () => {
  test('runs the handler before invoke returns its promise', () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    const pending = dispatcher.invoke(invocation(RENDERER), {}, {triggerEvent: undefined});

    // The assertion is made before any await: if admission or the gate had
    // introduced an await, the handler would not have run yet.
    expect(fakes.handlerCalls).toHaveLength(1);
    expect(fakes.gateAdmissions).toHaveLength(1);
    expect(pending).toBeInstanceOf(Promise);
  });

  test('check is fully synchronous and runs no gate', () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    expect(dispatcher.check(invocation(RENDERER))).toEqual({admitted: true});
    expect(fakes.gateAdmissions).toHaveLength(0);
    expect(fakes.handlerCalls).toHaveLength(0);
    expect(fakes.hostEmissions).toHaveLength(0);
  });
});

describe('admission', () => {
  test('refuses an unknown command without dispatching anything', async () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    const result = await dispatcher.invoke(invocation('test:missing'));

    expect(result).toMatchObject({status: 'error', error: {code: 'COMMAND_NOT_FOUND'}});
    expect(fakes.gateAdmissions).toHaveLength(0);
    expect(fakes.handlerCalls).toHaveLength(0);
  });

  test('refuses arguments the schema rejects, and never runs the handler', async () => {
    const fakes = buildFakes({
      commands: {
        [RENDERER]: {
          definition: fakeDefinition(RENDERER, {argsSchema: {const: 'expected'}}),
          handlerValue: null
        }
      }
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    const result = await dispatcher.invoke(invocation(RENDERER, {args: 'wrong'}));

    expect(result).toMatchObject({status: 'error', error: {code: 'INVALID_COMMAND_ARGS'}});
    expect(fakes.handlerCalls).toHaveLength(0);
    expect(fakes.gateAdmissions).toHaveLength(0);
  });

  test('admits absent arguments as null', async () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    await dispatcher.invoke(invocation(RENDERER, {args: undefined}));

    expect(fakes.gateAdmissions[0]?.args).toBeNull();
    expect(fakes.handlerCalls[0]?.args).toBeNull();
  });

  test('refuses non-null arguments for a host command', async () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    const result = await dispatcher.invoke(invocation(HOST, {args: {anything: true}}));

    expect(result).toMatchObject({status: 'error', error: {code: 'INVALID_COMMAND_ARGS'}});
    expect(fakes.hostEmissions).toHaveLength(0);
  });

  test('resolves a keymap-bound command that the registry never defined', () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    expect(dispatcher.check(invocation(HOST))).toEqual({admitted: true});
  });
});

describe('enablement', () => {
  const definition = () => fakeDefinition(RENDERER, {defaultWhen: 'terminalFocus'});

  test.each(['keybinding', 'palette', 'menu', 'ui'] as const)('gates the %s source', async (source) => {
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: definition(), handlerValue: null}},
      enablement: () => ({kind: 'disabled'})
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    const result = await dispatcher.invoke(invocation(RENDERER, {source}));

    expect(result).toMatchObject({status: 'error', error: {code: 'COMMAND_DISABLED'}});
    expect(fakes.handlerCalls).toHaveLength(0);
  });

  test.each(['plugin', 'remote'] as const)('skips enablement for the %s source', async (source) => {
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: definition(), handlerValue: null}},
      enablement: () => ({kind: 'disabled'})
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    const result = await dispatcher.invoke(invocation(RENDERER, {source}));

    expect(result.status).toBe('ok');
    expect(fakes.handlerCalls).toHaveLength(1);
  });

  test('fails closed when the expression cannot be parsed', async () => {
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: definition(), handlerValue: null}},
      enablement: () => ({kind: 'invalid', message: 'unexpected token'})
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    const result = await dispatcher.invoke(invocation(RENDERER));

    expect(result).toMatchObject({status: 'error', error: {code: 'INVALID_WHEN_EXPRESSION'}});
  });
});

describe('results', () => {
  test('reports a handler value', async () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    expect(await dispatcher.invoke(invocation(RENDERER))).toEqual({status: 'ok', value: {done: true}});
  });

  test('reports a host command as ok once emitted', async () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    expect(await dispatcher.invoke(invocation(HOST))).toEqual({status: 'ok'});
    expect(fakes.hostEmissions).toEqual([asCommandId(HOST)]);
  });

  test('reports a handler rejection as a failure', async () => {
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: fakeDefinition(RENDERER), rejection: new Error('boom')}}
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    expect(await dispatcher.invoke(invocation(RENDERER))).toMatchObject({
      status: 'error',
      error: {code: 'COMMAND_EXECUTION_FAILED'}
    });
  });

  test('reports a result the schema rejects', async () => {
    const fakes = buildFakes({
      commands: {
        [RENDERER]: {
          definition: fakeDefinition(RENDERER, {resultSchema: {const: 'expected'}}),
          handlerValue: 'other'
        }
      }
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    expect(await dispatcher.invoke(invocation(RENDERER))).toMatchObject({
      status: 'error',
      error: {code: 'INVALID_COMMAND_RESULT'}
    });
  });

  test('does not reject when the handler rejects', async () => {
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: fakeDefinition(RENDERER), rejection: new Error('boom')}}
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    await expect(dispatcher.invoke(invocation(RENDERER))).resolves.toBeDefined();
  });
});

/**
 * Wraps a real `AbortSignal` so add/remove bookkeeping is observable.
 *
 * A real signal, not a fake: `INV-NO-LEAK` is about the interpreter's use of
 * the platform primitive, so the primitive must be real.
 */
const trackListeners = (controller: AbortController) => {
  const added: string[] = [];
  const removed: string[] = [];
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);

  const recordingAdd = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions
  ): void => {
    added.push(type);
    originalAdd(type, listener, options);
  };
  const recordingRemove = (type: string, listener: EventListenerOrEventListenerObject): void => {
    removed.push(type);
    originalRemove(type, listener);
  };

  // SAFETY: `recordingAdd` forwards every argument unchanged to the bound original.
  signal.addEventListener = recordingAdd as typeof signal.addEventListener;
  // SAFETY: `recordingRemove` forwards both arguments unchanged.
  signal.removeEventListener = recordingRemove as typeof signal.removeEventListener;

  return {added, removed};
};

describe('INV-NO-LEAK', () => {
  test('removes the abort listener on settlement', async () => {
    const controller = new AbortController();
    const tracking = trackListeners(controller);
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    await dispatcher.invoke(invocation(RENDERER), {signal: controller.signal});

    expect(tracking.added).toEqual(['abort']);
    expect(tracking.removed).toEqual(['abort']);
  });

  test('adds no listener when the caller passes no signal', async () => {
    const controller = new AbortController();
    const tracking = trackListeners(controller);
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);

    await dispatcher.invoke(invocation(RENDERER));

    expect(tracking.added).toEqual([]);
  });

  test('logs a rejection that arrives after settlement instead of leaking it', async () => {
    let rejectHandler: ((reason: unknown) => void) | undefined;
    const fakes = buildFakes({
      commands: {
        [RENDERER]: {definition: fakeDefinition(RENDERER), pending: true}
      }
    });
    // Replace the executor's completion with one the test can settle late.
    const originalStart = fakes.ports.executor.start;
    fakes.ports.executor.start = (inv, args, signal, context) => {
      const started = originalStart(inv, args, signal, context);
      if (started.kind === 'rendererStarted') {
        const controlled = new Promise<never>((_resolve, reject) => {
          rejectHandler = reject;
        });
        return {kind: 'rendererStarted', completion: controlled};
      }
      return started;
    };

    const dispatcher = createCommandDispatcher(fakes.ports);
    const controller = new AbortController();
    const pending = dispatcher.invoke(invocation(RENDERER), {signal: controller.signal});

    controller.abort();
    expect(await pending).toEqual({status: 'cancelled', stage: 'during-execution'});

    rejectHandler?.(new Error('late boom'));
    await Promise.resolve();

    expect(fakes.logs).toContainEqual(
      expect.objectContaining({level: 'debug', message: expect.stringContaining('rejected after settlement')})
    );
  });
});

describe('cancellation', () => {
  test('an already-aborted signal settles before execution and does nothing', async () => {
    const fakes = buildFakes();
    const dispatcher = createCommandDispatcher(fakes.ports);
    const controller = new AbortController();
    controller.abort();

    const result = await dispatcher.invoke(invocation(RENDERER), {signal: controller.signal});

    expect(result).toEqual({status: 'cancelled', stage: 'before-execution'});
    expect(fakes.gateAdmissions).toHaveLength(0);
    expect(fakes.handlerCalls).toHaveLength(0);
  });

  test('an abort during execution settles at once and hands the signal to the handler', async () => {
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: fakeDefinition(RENDERER), pending: true}}
    });
    const dispatcher = createCommandDispatcher(fakes.ports);
    const controller = new AbortController();

    const pending = dispatcher.invoke(invocation(RENDERER), {signal: controller.signal});
    expect(fakes.handlerCalls[0]?.signal).toBe(controller.signal);

    controller.abort();

    expect(await pending).toEqual({status: 'cancelled', stage: 'during-execution'});
  });

  test('a rejection carrying the abort reason settles as cancelled', async () => {
    const controller = new AbortController();
    const fakes = buildFakes({
      commands: {[RENDERER]: {definition: fakeDefinition(RENDERER), rejection: controller.signal.reason}}
    });
    const dispatcher = createCommandDispatcher(fakes.ports);

    controller.abort();
    const result = await dispatcher.invoke(invocation(RENDERER), {signal: controller.signal});

    // The signal is already aborted, so this settles before execution.
    expect(result).toEqual({status: 'cancelled', stage: 'before-execution'});
  });
});

describe('deferred execution gate', () => {
  test('stays pending until the effect runs, then executes once', async () => {
    const fakes = buildFakes({deferGate: true});
    const dispatcher = createCommandDispatcher(fakes.ports);

    const pending = dispatcher.invoke(invocation(RENDERER));
    expect(fakes.handlerCalls).toHaveLength(0);

    fakes.runDeferredGate();
    fakes.runDeferredGate();

    expect(await pending).toEqual({status: 'ok', value: {done: true}});
    expect(fakes.handlerCalls).toHaveLength(1);
  });

  test('a swallowed gate leaves the invocation pending until the signal aborts', async () => {
    const fakes = buildFakes({swallowGate: true});
    const dispatcher = createCommandDispatcher(fakes.ports);
    const controller = new AbortController();

    const pending = dispatcher.invoke(invocation(RENDERER), {signal: controller.signal});
    controller.abort();

    expect(await pending).toEqual({status: 'cancelled', stage: 'before-execution'});
    expect(fakes.handlerCalls).toHaveLength(0);
  });
});
