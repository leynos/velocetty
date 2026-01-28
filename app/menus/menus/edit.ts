/** @file Defines the Edit menu template and command bindings. */
import type {MenuItemConstructorOptions} from 'electron';

import {makeMenuCommandExecutor, type MenuCommandRunner} from './utils';

const editMenu = (commandKeys: Record<string, string>, execCommand: MenuCommandRunner) => {
  const execWithBrowserWindow = makeMenuCommandExecutor(execCommand);

  const submenu: MenuItemConstructorOptions[] = [
    {
      label: 'Undo',
      accelerator: commandKeys['editor:undo'],
      enabled: false
    },
    {
      label: 'Redo',
      accelerator: commandKeys['editor:redo'],
      enabled: false
    },
    {
      type: 'separator'
    },
    {
      label: 'Cut',
      accelerator: commandKeys['editor:cut'],
      enabled: false
    },
    {
      role: 'copy',
      command: 'editor:copy',
      accelerator: commandKeys['editor:copy'],
      registerAccelerator: true
    } as any,
    {
      role: 'paste',
      accelerator: commandKeys['editor:paste'],
      registerAccelerator: true
    },
    {
      label: 'Select All',
      accelerator: commandKeys['editor:selectAll'],
      click(_item, focusedWindow) {
        execWithBrowserWindow('editor:selectAll', focusedWindow);
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Move to...',
      submenu: [
        {
          label: 'Previous word',
          accelerator: commandKeys['editor:movePreviousWord'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:movePreviousWord', focusedWindow);
          }
        },
        {
          label: 'Next word',
          accelerator: commandKeys['editor:moveNextWord'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:moveNextWord', focusedWindow);
          }
        },
        {
          label: 'Line beginning',
          accelerator: commandKeys['editor:moveBeginningLine'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:moveBeginningLine', focusedWindow);
          }
        },
        {
          label: 'Line end',
          accelerator: commandKeys['editor:moveEndLine'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:moveEndLine', focusedWindow);
          }
        }
      ]
    },
    {
      label: 'Delete...',
      submenu: [
        {
          label: 'Previous word',
          accelerator: commandKeys['editor:deletePreviousWord'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:deletePreviousWord', focusedWindow);
          }
        },
        {
          label: 'Next word',
          accelerator: commandKeys['editor:deleteNextWord'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:deleteNextWord', focusedWindow);
          }
        },
        {
          label: 'Line beginning',
          accelerator: commandKeys['editor:deleteBeginningLine'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:deleteBeginningLine', focusedWindow);
          }
        },
        {
          label: 'Line end',
          accelerator: commandKeys['editor:deleteEndLine'],
          click(_item, focusedWindow) {
            execWithBrowserWindow('editor:deleteEndLine', focusedWindow);
          }
        }
      ]
    },
    {
      type: 'separator'
    },
    {
      label: 'Clear Buffer',
      accelerator: commandKeys['editor:clearBuffer'],
      click(_item, focusedWindow) {
        execWithBrowserWindow('editor:clearBuffer', focusedWindow);
      }
    },
    {
      label: 'Search',
      accelerator: commandKeys['editor:search'],
      click(_item, focusedWindow) {
        execWithBrowserWindow('editor:search', focusedWindow);
      }
    }
  ];

  if (process.platform !== 'darwin') {
    submenu.push(
      {type: 'separator'},
      {
        label: 'Preferences...',
        accelerator: commandKeys['window:preferences'],
        click() {
          execWithBrowserWindow('window:preferences');
        }
      }
    );
  }

  return {
    label: 'Edit',
    submenu
  };
};

export default editMenu;
