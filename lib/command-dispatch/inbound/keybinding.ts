/**
 * @file Inbound adapter that turns key presses into dispatcher invocations.
 *
 * Responsibilities:
 * - Fetch the keymap, then apply the registry sync, the keymap snapshot, and
 *   the new bindings in one synchronous block guarded by a generation counter,
 *   so two overlapping reloads cannot leave the bound keys and the snapshot
 *   describing different reloads.
 * - Ask the dispatcher's admission phase before marking the event. A refused
 *   shortcut must not swallow the key; it reaches the terminal.
 * - Keep the `catched` flag and `shouldPreventDefault` behaviour for admitted
 *   commands, because xterm reads `catched` synchronously in the same keydown.
 *
 * Invariants:
 * - A failed fetch leaves the previous bindings intact and logs a warning.
 * - Only the most recently started reload that completed wins; a stale
 *   completion is dropped rather than applied.
 * - A handler runs synchronously inside the keydown callback for admitted
 *   commands, which is what lets a legacy plugin handler call
 *   `event.preventDefault()` in time.
 *
 * Usage:
 * - `lib/containers/hyper.tsx` creates one and calls `reload()` when the
 *   configuration changes.
 *
 * Related modules:
 * - `../dispatcher.ts` answers `check` and `invoke`.
 * - `../../command-registry.ts` supplies the keymap and `shouldPreventDefault`.
 */
import {asCommandId, type CommandId, type CommandResult} from '@shared/types/commands';
import {shouldPreventDefault} from '../../command-registry';
import type {InterpretingDispatcher} from '../dispatcher';
import type {DispatcherLogger} from '../ports';
import type {RendererExecutionContext} from '../adapters/renderer-executor';

/** The keymap lookup the binder needs. */
export interface KeymapSource {
  /** Resolves shortcut → command, and synchronizes runtime plugin commands. */
  getRegisteredKeys(): Promise<Record<string, string>>;
}

/** The slice of Mousetrap the binder uses. */
export interface MousetrapLike {
  bind(keys: string, callback: (event: KeyboardEvent & {catched?: boolean}) => void, action: 'keydown'): void;
  reset(): void;
}

export interface KeybindingBinderDependencies {
  readonly dispatcher: InterpretingDispatcher<RendererExecutionContext>;
  readonly keymap: KeymapSource;
  /** Creates or returns the Mousetrap instance bound to the document. */
  readonly getMousetrap: () => MousetrapLike;
  readonly logger: DispatcherLogger;
  /** Receives the command identifiers the latest completed keymap binds. */
  readonly onSnapshot: (boundCommandIds: ReadonlySet<string>) => void;
}

export interface KeybindingBinder {
  /**
   * Reloads the keymap and rebinds. Safe to call while another reload is in
   * flight: only the newest completion is applied.
   */
  reload(): Promise<void>;
  /** Drops every binding and forgets the snapshot. */
  reset(): void;
}

const eventKind = (error: CommandResult): string => (error.status === 'error' ? error.error.code : error.status);

/** Builds the keybinding binder. */
export const createKeybindingBinder = (dependencies: KeybindingBinderDependencies): KeybindingBinder => {
  const {dispatcher, keymap, logger} = dependencies;
  // One counter for the whole binder: a completion whose generation is not the
  // current one started before the winning reload and must be dropped.
  let generation = 0;
  let boundCommandIds: ReadonlySet<string> = new Set();
  /** Commands already reported in the current generation, so one broken
   *  shortcut cannot flood the console on every press. */
  let reported = new Set<CommandId>();

  const reportOnce = (commandId: CommandId, result: CommandResult): void => {
    if (result.status === 'ok' || reported.has(commandId)) {
      return;
    }
    reported.add(commandId);
    logger.warn('keybinding invocation did not succeed', {
      commandId,
      outcome: eventKind(result)
    });
  };

  const bindShortcut = (instance: MousetrapLike, shortcut: string, commandId: CommandId): void => {
    instance.bind(
      shortcut,
      (event) => {
        const invocation = {id: commandId, args: null, source: 'keybinding' as const};
        const admission = dispatcher.check(invocation);

        if (!admission.admitted) {
          // D-13: a refused shortcut passes the key through. Logging at debug
          // for a disabled command avoids warning about a working gate.
          const code = admission.error?.code;
          const details = {commandId, outcome: code ?? 'unknown'};
          if (code === 'COMMAND_DISABLED') {
            logger.debug('keybinding refused; passing the key through', details);
          } else {
            logger.warn('keybinding refused; passing the key through', details);
          }
          return;
        }

        const caughtEvent = Object.assign(event, {catched: true});
        if (shouldPreventDefault(commandId)) {
          event.preventDefault();
        }

        void dispatcher.invoke(invocation, {}, {triggerEvent: caughtEvent}).then((result) => {
          reportOnce(commandId, result);
        });
      },
      'keydown'
    );
  };

  return {
    reload: async () => {
      generation += 1;
      const startedAt = generation;

      let keys: Record<string, string>;
      try {
        keys = await keymap.getRegisteredKeys();
      } catch (error) {
        // Keep the bindings that are already installed: losing every shortcut
        // because one IPC call failed would be worse than a stale keymap.
        logger.warn('keymap reload failed; keeping the existing bindings', {
          reason: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      if (startedAt !== generation) {
        return;
      }

      const nextBoundCommandIds = new Set(Object.values(keys));
      const instance = dependencies.getMousetrap();
      instance.reset();
      reported = new Set();

      for (const shortcut of Object.keys(keys)) {
        bindShortcut(instance, shortcut, asCommandId(keys[shortcut]));
      }

      boundCommandIds = nextBoundCommandIds;
      dependencies.onSnapshot(boundCommandIds);
    },

    reset: () => {
      generation += 1;
      boundCommandIds = new Set();
      reported = new Set();
      dependencies.onSnapshot(boundCommandIds);
      dependencies.getMousetrap().reset();
    }
  };
};
