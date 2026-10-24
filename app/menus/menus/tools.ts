import type {BrowserWindow, MenuItemConstructorOptions} from 'electron';
import type {CommandId} from '@shared/types/commands';
import {asCommandId} from '../../utils/shared-ids';

const toolsMenu = (
  commands: Record<string, string>,
  execCommand: (command: CommandId, focusedWindow?: BrowserWindow) => void
): MenuItemConstructorOptions => {
  return {
    label: 'Tools',
    submenu: [
      {
        label: 'Update plugins',
        accelerator: commands['plugins:update'],
        click() {
          execCommand(asCommandId('plugins:update'));
        }
      },
      {
        label: 'Install Hyper CLI command in PATH',
        click() {
          execCommand(asCommandId('cli:install'));
        }
      },
      {
        type: 'separator'
      },
      ...(process.platform === 'win32'
        ? ([
            {
              label: 'Add Hyper to system context menu',
              click() {
                execCommand(asCommandId('systemContextMenu:add'));
              }
            },
            {
              label: 'Remove Hyper from system context menu',
              click() {
                execCommand(asCommandId('systemContextMenu:remove'));
              }
            },
            {
              type: 'separator'
            }
          ] satisfies MenuItemConstructorOptions[])
        : [])
    ]
  };
};

export default toolsMenu;
