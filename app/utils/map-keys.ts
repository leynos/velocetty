const generatePrefixedCommand = (command: string, shortcuts: string[]) => {
  const result: Record<string, string[]> = {};
  const baseCmd = command.replace(/:prefix$/, '');
  for (let i = 1; i <= 9; i++) {
    // 9 is a special number because it means 'last'
    const index = i === 9 ? 'last' : i;
    const prefixedShortcuts = shortcuts.map((shortcut) => `${shortcut}+${i}`);
    result[`${baseCmd}:${index}`] = prefixedShortcuts;
  }

  return result;
};

const mapKeys = (config: Record<string, string[] | string>) => {
  const keymap: Record<string, string[]> = {};
  for (const command of Object.keys(config)) {
    if (!command) {
      continue;
    }
    // We can have different keys for a same command.
    const _shortcuts = config[command];
    const shortcuts = Array.isArray(_shortcuts) ? _shortcuts : [_shortcuts];
    const fixedShortcuts: string[] = [];
    shortcuts.forEach((shortcut) => {
      let newShortcut = shortcut;
      if (newShortcut.includes('cmd')) {
        // Mousetrap use `command` and not `cmd`
        console.warn('Your config use deprecated `cmd` in key combination. Please use `command` instead.');
        newShortcut = newShortcut.replace('cmd', 'command');
      }
      fixedShortcuts.push(newShortcut);
    });

    if (command.endsWith(':prefix')) {
      Object.assign(keymap, generatePrefixedCommand(command, fixedShortcuts));
      continue;
    }

    keymap[command] = fixedShortcuts;
  }
  return keymap;
};

export default mapKeys;
