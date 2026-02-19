/** @file Defines the View menu template for window and zoom commands. */
import type {MenuItemConstructorOptions} from 'electron';
import type {CommandId} from '@shared/types/commands';

import {makeMenuCommandExecutor, type MenuCommandRunner} from './utils';

const asCommandId = (command: string): CommandId => command as CommandId;

const viewMenu = (commandKeys: Record<string, string>, execCommand: MenuCommandRunner): MenuItemConstructorOptions => {
  const execWithBrowserWindow = makeMenuCommandExecutor(execCommand);

  return {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: commandKeys['window:reload'],
        click(_item, focusedWindow) {
          execWithBrowserWindow(asCommandId('window:reload'), focusedWindow);
        }
      },
      {
        label: 'Full Reload',
        accelerator: commandKeys['window:reloadFull'],
        click(_item, focusedWindow) {
          execWithBrowserWindow(asCommandId('window:reloadFull'), focusedWindow);
        }
      },
      {
        label: 'Developer Tools',
        accelerator: commandKeys['window:devtools'],
        click: (_item, focusedWindow) => {
          execWithBrowserWindow(asCommandId('window:devtools'), focusedWindow);
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Reset Zoom Level',
        accelerator: commandKeys['zoom:reset'],
        click(_item, focusedWindow) {
          execWithBrowserWindow(asCommandId('zoom:reset'), focusedWindow);
        }
      },
      {
        label: 'Zoom In',
        accelerator: commandKeys['zoom:in'],
        click(_item, focusedWindow) {
          execWithBrowserWindow(asCommandId('zoom:in'), focusedWindow);
        }
      },
      {
        label: 'Zoom Out',
        accelerator: commandKeys['zoom:out'],
        click(_item, focusedWindow) {
          execWithBrowserWindow(asCommandId('zoom:out'), focusedWindow);
        }
      }
    ]
  };
};

export default viewMenu;
