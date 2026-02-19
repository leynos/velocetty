// This menu label is overrided by OSX to be the appName
// The label is set to appName here so it matches actual behavior
import {app} from 'electron';
import type {BrowserWindow, MenuItemConstructorOptions} from 'electron';
import type {CommandId} from '@shared/types/commands';

const darwinMenu = (
  commandKeys: Record<string, string>,
  execCommand: (command: CommandId, focusedWindow?: BrowserWindow) => void,
  showAbout: () => void
): MenuItemConstructorOptions => {
  return {
    label: `${app.name}`,
    submenu: [
      {
        label: 'About Hyper',
        click() {
          showAbout();
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Preferences...',
        accelerator: commandKeys['window:preferences'],
        click() {
          execCommand('window:preferences' as CommandId);
        }
      },
      {
        type: 'separator'
      },
      {
        role: 'services',
        submenu: []
      },
      {
        type: 'separator'
      },
      {
        role: 'hide'
      },
      {
        role: 'hideOthers'
      },
      {
        role: 'unhide'
      },
      {
        type: 'separator'
      },
      {
        role: 'quit'
      }
    ]
  };
};

export default darwinMenu;
