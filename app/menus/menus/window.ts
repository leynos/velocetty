/** @file Builds the Window menu template for tab and pane navigation. */
import type {MenuItemConstructorOptions} from 'electron';

import {makeMenuCommandExecutor, type MenuCommandRunner} from './utils';

const windowMenu = (
  commandKeys: Record<string, string>,
  execCommand: MenuCommandRunner
): MenuItemConstructorOptions => {
  const execWithBrowserWindow = makeMenuCommandExecutor(execCommand);

  // Generating tab:jump array
  const tabJump: MenuItemConstructorOptions[] = [];
  for (let i = 1; i <= 9; i++) {
    // 9 is a special number because it means 'last'
    const label = i === 9 ? 'Last' : `${i}`;
    tabJump.push({
      label,
      accelerator: commandKeys[`tab:jump:${label.toLowerCase()}`],
      click: (_item, focusedWindow) => {
        execWithBrowserWindow(`tab:jump:${label.toLowerCase()}`, focusedWindow);
      }
    });
  }

  return {
    role: 'window',
    submenu: [
      {
        role: 'minimize',
        accelerator: commandKeys['window:minimize']
      },
      {
        type: 'separator'
      },
      {
        // It's the same thing as clicking the green traffc-light on macOS
        role: 'zoom',
        accelerator: commandKeys['window:zoom']
      },
      {
        label: 'Select Tab',
        submenu: [
          {
            label: 'Previous',
            accelerator: commandKeys['tab:prev'],
            click: (_item, focusedWindow) => {
              execWithBrowserWindow('tab:prev', focusedWindow);
            }
          },
          {
            label: 'Next',
            accelerator: commandKeys['tab:next'],
            click: (_item, focusedWindow) => {
              execWithBrowserWindow('tab:next', focusedWindow);
            }
          },
          {
            type: 'separator'
          },
          ...tabJump
        ]
      },
      {
        type: 'separator'
      },
      {
        label: 'Select Pane',
        submenu: [
          {
            label: 'Previous',
            accelerator: commandKeys['pane:prev'],
            click: (_item, focusedWindow) => {
              execWithBrowserWindow('pane:prev', focusedWindow);
            }
          },
          {
            label: 'Next',
            accelerator: commandKeys['pane:next'],
            click: (_item, focusedWindow) => {
              execWithBrowserWindow('pane:next', focusedWindow);
            }
          }
        ]
      },
      {
        type: 'separator'
      },
      {
        role: 'front'
      },
      {
        label: 'Toggle Always on Top',
        click: (_item, focusedWindow) => {
          execWithBrowserWindow('window:toggleKeepOnTop', focusedWindow);
        }
      },
      {
        role: 'togglefullscreen',
        accelerator: commandKeys['window:toggleFullScreen']
      }
    ]
  };
};

export default windowMenu;
