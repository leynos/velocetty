import type {BrowserWindow, MenuItemConstructorOptions} from 'electron';
import type {CommandId} from '@shared/types/commands';

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
          execCommand('plugins:update' as CommandId);
        }
      },
      {
        label: 'Install Hyper CLI command in PATH',
        click() {
          execCommand('cli:install' as CommandId);
        }
      },
      {
        type: 'separator'
      },
      ...(process.platform === 'win32'
        ? <MenuItemConstructorOptions[]>[
            {
              label: 'Add Hyper to system context menu',
              click() {
                execCommand('systemContextMenu:add' as CommandId);
              }
            },
            {
              label: 'Remove Hyper from system context menu',
              click() {
                execCommand('systemContextMenu:remove' as CommandId);
              }
            },
            {
              type: 'separator'
            }
          ]
        : [])
    ]
  };
};

export default toolsMenu;
