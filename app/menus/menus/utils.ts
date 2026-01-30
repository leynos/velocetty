/** @file Shared helpers for menu command execution. */
import {BrowserWindow} from 'electron';

export type MenuCommandRunner = (command: string, focusedWindow?: BrowserWindow) => void;

export const toBrowserWindow = (focusedWindow?: unknown): BrowserWindow | undefined =>
  focusedWindow instanceof BrowserWindow ? focusedWindow : undefined;

export const makeMenuCommandExecutor = (execCommand: MenuCommandRunner) => {
  return (command: string, focusedWindow?: unknown) => {
    execCommand(command, toBrowserWindow(focusedWindow));
  };
};
