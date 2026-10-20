/** @file Builds context menu templates for terminal selections. */
import type {MenuItemConstructorOptions} from 'electron';

import {execCommand} from '../commands';
import {getProfiles} from '../config';
import editMenu from '../menus/menus/edit';
import shellMenu from '../menus/menus/shell';
import {getDecoratedKeymaps} from '../plugins';

const separator: MenuItemConstructorOptions = {type: 'separator'};

const getCommandKeys = (keymaps: Record<string, string[]>) => {
  const commandKeys: Record<string, string> = {};
  for (const [command, keys] of Object.entries(keymaps)) {
    const firstKey = keys.at(0);
    if (firstKey !== undefined) {
      commandKeys[command] = firstKey;
    }
  }
  return commandKeys;
};

// only display cut/copy when there's a cursor selection
const filterCutCopy = (selection: string, menuItem: MenuItemConstructorOptions) => {
  if (/^cut$|^copy$/.test(menuItem.role!) && !selection) {
    return;
  }
  return menuItem;
};

const contextMenuTemplate = (selection: string) => {
  const commandKeys = getCommandKeys(getDecoratedKeymaps());
  const _shell = shellMenu(
    commandKeys,
    execCommand,
    getProfiles().map((p) => p.name)
  ).submenu;
  const _edit = editMenu(commandKeys, execCommand).submenu.filter(filterCutCopy.bind(null, selection));
  return [..._edit, separator, ..._shell].filter((menuItem) => !Object.hasOwn(menuItem, 'enabled') || menuItem.enabled);
};

export default contextMenuTemplate;
