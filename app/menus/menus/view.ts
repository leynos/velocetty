/** @file Defines the View menu template for window and zoom commands. */
import {BrowserWindow, type MenuItemConstructorOptions} from 'electron';

const toBrowserWindow = (focusedWindow?: unknown): BrowserWindow | undefined =>
  focusedWindow instanceof BrowserWindow ? focusedWindow : undefined;

const viewMenu = (
  commandKeys: Record<string, string>,
  execCommand: (command: string, focusedWindow?: BrowserWindow) => void
): MenuItemConstructorOptions => {
  const execWithBrowserWindow = (command: string, focusedWindow?: unknown) => {
    execCommand(command, toBrowserWindow(focusedWindow));
  };

  return {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: commandKeys['window:reload'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('window:reload', focusedWindow);
        }
      },
      {
        label: 'Full Reload',
        accelerator: commandKeys['window:reloadFull'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('window:reloadFull', focusedWindow);
        }
      },
      {
        label: 'Developer Tools',
        accelerator: commandKeys['window:devtools'],
        click: (_item, focusedWindow) => {
          execWithBrowserWindow('window:devtools', focusedWindow);
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Reset Zoom Level',
        accelerator: commandKeys['zoom:reset'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('zoom:reset', focusedWindow);
        }
      },
      {
        label: 'Zoom In',
        accelerator: commandKeys['zoom:in'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('zoom:in', focusedWindow);
        }
      },
      {
        label: 'Zoom Out',
        accelerator: commandKeys['zoom:out'],
        click(_item, focusedWindow) {
          execWithBrowserWindow('zoom:out', focusedWindow);
        }
      }
    ]
  };
};

export default viewMenu;
