/** @file Provides the shell/file menu template for tab and pane actions. */
import type {MenuItemConstructorOptions} from 'electron';

import {makeMenuCommandExecutor, type MenuCommandRunner} from './utils';

const shellMenu = (
  commandKeys: Record<string, string>,
  execCommand: MenuCommandRunner,
  profiles: string[]
): MenuItemConstructorOptions => {
  const isMac = process.platform === 'darwin';
  const execWithBrowserWindow = makeMenuCommandExecutor(execCommand);

  return {
    label: isMac ? 'Shell' : 'File',
    submenu: [
      {
        label: 'New Tab',
        accelerator: commandKeys['tab:new'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('tab:new', focusedWindow);
        }
      },
      {
        label: 'New Window',
        accelerator: commandKeys['window:new'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('window:new', focusedWindow);
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Split Down',
        accelerator: commandKeys['pane:splitDown'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('pane:splitDown', focusedWindow);
        }
      },
      {
        label: 'Split Right',
        accelerator: commandKeys['pane:splitRight'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('pane:splitRight', focusedWindow);
        }
      },
      {
        type: 'separator'
      },
      ...profiles.map(
        (profile): MenuItemConstructorOptions => ({
          label: profile,
          submenu: [
            {
              label: 'New Tab',
              accelerator: commandKeys[`tab:new:${profile}`],
              click(_item, focusedWindow) {
                execWithBrowserWindow(`tab:new:${profile}`, focusedWindow);
              }
            },
            {
              label: 'New Window',
              accelerator: commandKeys[`window:new:${profile}`],
              click(_item, focusedWindow) {
                execWithBrowserWindow(`window:new:${profile}`, focusedWindow);
              }
            },
            {
              type: 'separator'
            },
            {
              label: 'Split Down',
              accelerator: commandKeys[`pane:splitDown:${profile}`],
              click(_item, focusedWindow) {
                execWithBrowserWindow(`pane:splitDown:${profile}`, focusedWindow);
              }
            },
            {
              label: 'Split Right',
              accelerator: commandKeys[`pane:splitRight:${profile}`],
              click(_item, focusedWindow) {
                execWithBrowserWindow(`pane:splitRight:${profile}`, focusedWindow);
              }
            }
          ]
        })
      ),
      {
        type: 'separator'
      },
      {
        label: 'Close',
        accelerator: commandKeys['pane:close'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('pane:close', focusedWindow);
        }
      },
      {
        label: isMac ? 'Close Window' : 'Quit',
        role: 'close',
        accelerator: commandKeys['window:close']
      }
    ]
  };
};

export default shellMenu;
