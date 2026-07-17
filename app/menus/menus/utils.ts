/** @file Shared helpers for menu command execution. */
import {BrowserWindow} from 'electron';
import type {CommandId} from '@shared/types/commands';

/** Signature of the app's command executor, as passed to menu builders. */
export type MenuCommandRunner = (command: CommandId, focusedWindow?: BrowserWindow) => void;

/** Narrows an Electron click handler's `focusedWindow` argument to a real `BrowserWindow`. */
export const toBrowserWindow = (focusedWindow?: unknown): BrowserWindow | undefined =>
  focusedWindow instanceof BrowserWindow ? focusedWindow : undefined;

const asCommandId = (command: string | CommandId): CommandId => command as CommandId;

/** Wraps a command runner so menu `click` handlers can pass loosely typed arguments safely. */
export const makeMenuCommandExecutor = (execCommand: MenuCommandRunner) => {
  return (command: CommandId, focusedWindow?: unknown) => {
    execCommand(asCommandId(command), toBrowserWindow(focusedWindow));
  };
};
