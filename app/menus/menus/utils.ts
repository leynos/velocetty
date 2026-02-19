/** @file Shared helpers for menu command execution. */
import {BrowserWindow} from 'electron';
import type {CommandId} from '@shared/types/commands';

export type MenuCommandRunner = (command: CommandId, focusedWindow?: BrowserWindow) => void;

export const toBrowserWindow = (focusedWindow?: unknown): BrowserWindow | undefined =>
  focusedWindow instanceof BrowserWindow ? focusedWindow : undefined;

const asCommandId = (command: string | CommandId): CommandId => command as CommandId;

export const makeMenuCommandExecutor = (execCommand: MenuCommandRunner) => {
  return (command: CommandId, focusedWindow?: unknown) => {
    execCommand(asCommandId(command), toBrowserWindow(focusedWindow));
  };
};
