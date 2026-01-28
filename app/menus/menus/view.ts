import type {BaseWindow, BrowserWindow, MenuItemConstructorOptions} from 'electron';

const viewMenu = (
  commandKeys: Record<string, string>,
  execCommand: (command: string, focusedWindow?: BrowserWindow | BaseWindow) => void
): MenuItemConstructorOptions => {
  return {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: commandKeys['window:reload'],
        click(_item, focusedWindow) {
          execCommand('window:reload', focusedWindow);
        }
      },
      {
        label: 'Full Reload',
        accelerator: commandKeys['window:reloadFull'],
        click(_item, focusedWindow) {
          execCommand('window:reloadFull', focusedWindow);
        }
      },
      {
        label: 'Developer Tools',
        accelerator: commandKeys['window:devtools'],
        click: (_item, focusedWindow) => {
          execCommand('window:devtools', focusedWindow);
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Reset Zoom Level',
        accelerator: commandKeys['zoom:reset'],
        click(_item, focusedWindow) {
          execCommand('zoom:reset', focusedWindow);
        }
      },
      {
        label: 'Zoom In',
        accelerator: commandKeys['zoom:in'],
        click(_item, focusedWindow) {
          execCommand('zoom:in', focusedWindow);
        }
      },
      {
        label: 'Zoom Out',
        accelerator: commandKeys['zoom:out'],
        click(_item, focusedWindow) {
          execCommand('zoom:out', focusedWindow);
        }
      }
    ]
  };
};

export default viewMenu;
