/**
 * @file Behavioural tests for the keybinding inbound adapter.
 *
 * Two decisions need evidence here, and neither is reachable from the machine's
 * proof:
 *
 * - D-13: a shortcut whose command is refused at admission must not swallow the
 *   key. The event is neither marked `catched` nor default-prevented, so xterm
 *   still receives it.
 * - D-12: a failed keymap fetch leaves the existing bindings installed, and a
 *   stale completion cannot displace a newer one.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/keybinding.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/inbound/keybinding.ts`
 */
import {describe, expect, test} from 'bun:test';

import {asCommandId, type CommandInvocation, type CommandResult} from '@shared/types/commands';
import type {JsonObject} from '@shared/types/json';
import {createKeybindingBinder, type MousetrapLike} from '../../../lib/command-dispatch/inbound/keybinding';
import type {AdmissionCheck, InterpretingDispatcher} from '../../../lib/command-dispatch/dispatcher';
import type {DispatcherLogger} from '../../../lib/command-dispatch/ports';
import type {RendererExecutionContext} from '../../../lib/command-dispatch/adapters/renderer-executor';

/** Shortcut → command, the shape a keymap reload returns. */
type KeyMap = Readonly<Record<string, string>>;

/** The event the binder hands a bound callback. */
interface BoundKeyEvent extends Event {
  catched?: boolean;
}

type BoundHandler = (event: BoundKeyEvent) => void;

/** A log line the recording logger captured. */
interface LogLine {
  readonly level: 'debug' | 'warn';
  readonly message: string;
  readonly details: JsonObject;
}

interface RecordedInvocation {
  readonly invocation: CommandInvocation;
  readonly context: RendererExecutionContext | undefined;
}

interface DispatcherDouble {
  readonly dispatcher: InterpretingDispatcher<RendererExecutionContext>;
  readonly invocations: RecordedInvocation[];
  readonly checked: CommandInvocation[];
}

interface DispatcherOptions {
  readonly admitted?: boolean;
  readonly result?: CommandResult;
  readonly admissionError?: AdmissionCheck['error'];
}

/** A Mousetrap double that records bindings and lets a test press one. */
const createMousetrap = () => {
  const bindings = new Map<string, BoundHandler[]>();
  let resets = 0;
  const instance: MousetrapLike = {
    bind: (keys, callback) => {
      bindings.set(keys, [...(bindings.get(keys) ?? []), callback]);
    },
    reset: () => {
      resets += 1;
      bindings.clear();
    }
  };
  return {instance, bindings, resets: () => resets};
};

/** A dispatcher double with a scripted admission verdict and result. */
const createDispatcher = (options: DispatcherOptions = {}): DispatcherDouble => {
  const invocations: RecordedInvocation[] = [];
  const checked: CommandInvocation[] = [];

  const admission: AdmissionCheck = options.admissionError
    ? {admitted: false, error: options.admissionError}
    : {admitted: options.admitted !== false};

  return {
    invocations,
    checked,
    dispatcher: {
      check: (invocation) => {
        checked.push(invocation);
        return admission;
      },
      invoke: async (invocation, _options, context) => {
        invocations.push({invocation, context});
        return options.result ?? {status: 'ok'};
      }
    }
  };
};

const createLogger = () => {
  const lines: LogLine[] = [];
  const logger: DispatcherLogger = {
    debug: (message, details) => {
      lines.push({level: 'debug', message, details});
    },
    warn: (message, details) => {
      lines.push({level: 'warn', message, details});
    }
  };
  return {logger, lines};
};

// `cancelable: true` is what makes `defaultPrevented` observable; a plain
// `Event` ignores `preventDefault()`.
const createKeyEvent = (): BoundKeyEvent => Object.assign(new Event('keydown', {cancelable: true}), {catched: false});

/** Presses the first handler bound to `shortcut`. */
const press = (bindings: Map<string, BoundHandler[]>, shortcut: string): BoundKeyEvent => {
  const handler = bindings.get(shortcut)?.at(0);
  if (!handler) {
    throw new Error(`Expected ${shortcut} to be bound`);
  }
  const event = createKeyEvent();
  handler(event);
  return event;
};

const createBinder = (
  keymap: () => Promise<KeyMap>,
  options: {dispatcher?: DispatcherDouble; mousetrap?: ReturnType<typeof createMousetrap>} = {}
) => {
  const mousetrap = options.mousetrap ?? createMousetrap();
  const dispatcherDouble = options.dispatcher ?? createDispatcher();
  const {logger, lines} = createLogger();
  const snapshots: ReadonlySet<string>[] = [];

  const binder = createKeybindingBinder({
    dispatcher: dispatcherDouble.dispatcher,
    keymap: {getRegisteredKeys: keymap},
    getMousetrap: () => mousetrap.instance,
    logger,
    onSnapshot: (ids) => snapshots.push(ids)
  });

  return {binder, mousetrap, dispatcherDouble, lines, snapshots};
};

describe('admitted shortcuts', () => {
  test('mark the event, prevent the default, and invoke with the trigger event', async () => {
    const harness = createBinder(async () => ({'ctrl+t': 'tab:new'}));

    await harness.binder.reload();
    const event = press(harness.mousetrap.bindings, 'ctrl+t');

    expect(event.catched).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(harness.dispatcherDouble.checked).toHaveLength(1);
    expect(harness.dispatcherDouble.invocations).toHaveLength(1);
    expect(harness.dispatcherDouble.invocations.at(0)?.invocation).toEqual({
      id: asCommandId('tab:new'),
      args: null,
      source: 'keybinding'
    });
    expect(harness.dispatcherDouble.invocations.at(0)?.context?.triggerEvent).toBe(event);
    expect(harness.snapshots.at(-1)).toEqual(new Set(['tab:new']));
  });

  test('keep the Electron role commands un-prevented', async () => {
    const harness = createBinder(async () => ({'ctrl+c': 'editor:copy'}));

    await harness.binder.reload();
    const event = press(harness.mousetrap.bindings, 'ctrl+c');

    expect(event.catched).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('D-13: refused shortcuts pass the key through', () => {
  test('a disabled command neither catches nor prevents the key', async () => {
    const harness = createBinder(async () => ({esc: 'editor:search-close'}), {
      dispatcher: createDispatcher({
        admissionError: {code: 'COMMAND_DISABLED', commandId: asCommandId('editor:search-close'), message: 'disabled'}
      })
    });

    await harness.binder.reload();
    const event = press(harness.mousetrap.bindings, 'esc');

    expect(event.catched).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(harness.dispatcherDouble.invocations).toHaveLength(0);
    expect(harness.lines).toContainEqual(expect.objectContaining({level: 'debug'}));
  });

  test('any other refusal warns rather than logging at debug level', async () => {
    const harness = createBinder(async () => ({'ctrl+t': 'tab:new'}), {
      dispatcher: createDispatcher({
        admissionError: {code: 'COMMAND_NOT_FOUND', commandId: asCommandId('tab:new'), message: 'missing'}
      })
    });

    await harness.binder.reload();
    press(harness.mousetrap.bindings, 'ctrl+t');

    expect(harness.lines).toContainEqual(expect.objectContaining({level: 'warn'}));
  });
});

describe('D-12: reloads', () => {
  test('a failed fetch keeps the bindings already installed', async () => {
    let shouldFail = false;
    const harness = createBinder(async () => {
      if (shouldFail) {
        throw new Error('ipc down');
      }
      return {'ctrl+t': 'tab:new'};
    });

    await harness.binder.reload();
    expect(harness.mousetrap.bindings.get('ctrl+t')).toHaveLength(1);

    shouldFail = true;
    await harness.binder.reload();

    expect(harness.mousetrap.bindings.get('ctrl+t')).toHaveLength(1);
    expect(harness.lines).toContainEqual(
      expect.objectContaining({level: 'warn', message: expect.stringContaining('keeping the existing bindings')})
    );
  });

  test('a reload replaces the previous bindings rather than adding to them', async () => {
    const keymaps: KeyMap[] = [{'ctrl+t': 'tab:new'}, {'ctrl+w': 'tab:close'}];
    let reloadIndex = 0;
    const harness = createBinder(async () => keymaps[reloadIndex] ?? {});

    await harness.binder.reload();
    reloadIndex = 1;
    await harness.binder.reload();

    expect(harness.mousetrap.bindings.has('ctrl+t')).toBe(false);
    expect(harness.mousetrap.bindings.get('ctrl+w')).toHaveLength(1);
  });

  test('a stale completion is dropped when a newer reload has started', async () => {
    const pending: ((keys: KeyMap) => void)[] = [];
    const harness = createBinder(
      () =>
        new Promise<KeyMap>((resolve) => {
          pending.push(resolve);
        })
    );

    const older = harness.binder.reload();
    const newer = harness.binder.reload();

    // The older fetch resolves last: its result must not win.
    pending.at(0)?.({'ctrl+t': 'tab:new'});
    pending.at(1)?.({'ctrl+w': 'tab:close'});
    await Promise.all([older, newer]);

    expect(harness.mousetrap.bindings.has('ctrl+t')).toBe(false);
    expect(harness.mousetrap.bindings.get('ctrl+w')).toHaveLength(1);
  });
});

describe('reported failures', () => {
  test('a failing invocation is reported once per command per generation', async () => {
    const harness = createBinder(async () => ({'ctrl+t': 'tab:new'}), {
      dispatcher: createDispatcher({
        result: {
          status: 'error',
          error: {code: 'COMMAND_EXECUTION_FAILED', commandId: asCommandId('tab:new'), message: 'boom'}
        }
      })
    });

    await harness.binder.reload();
    press(harness.mousetrap.bindings, 'ctrl+t');
    press(harness.mousetrap.bindings, 'ctrl+t');
    await Promise.resolve();

    expect(harness.lines.filter((line) => line.level === 'warn')).toHaveLength(1);

    // A new generation starts a fresh reporting window.
    await harness.binder.reload();
    press(harness.mousetrap.bindings, 'ctrl+t');
    await Promise.resolve();

    expect(harness.lines.filter((line) => line.level === 'warn')).toHaveLength(2);
  });
});
