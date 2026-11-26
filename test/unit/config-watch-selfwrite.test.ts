/**
 * @file Covers the scope of the self-write reload suppression.
 *
 * The composition root decides a reload is the settings writer's own from the
 * config text hash alone. These cases drive the real composition root over a
 * temporary directory so that decision is exercised together with a real
 * keybindings change landing in the same debounced reload.
 */
import {afterEach, expect, mock, test} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {getCurrentConfig} from '../../app/config/current-config';
import {recordWrittenText, resetConfigWriteState} from '../../app/config/config-write-state';
import {createWatchHarness, makeParsedConfig, settle} from '../testUtils/config-watch-harness';

const CONFIG_TEXT = '{config: {fontSize: 16}}';

/** Creates a directory holding the config text the writer "just wrote". */
const writeSelfWrittenConfig = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'velocetty-self-write-'));
  fs.writeFileSync(path.join(directory, 'config.json5'), CONFIG_TEXT, 'utf8');
  recordWrittenText(CONFIG_TEXT);
  return directory;
};

afterEach(() => {
  resetConfigWriteState();
  mock.restore();
});

test.serial('a self-written config reload with unchanged keymaps is not announced', async () => {
  const directory = writeSelfWrittenConfig();
  const harness = await createWatchHarness({configDir: directory});
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    // The reload re-reads the same keybindings, so nothing external changed.
    const reloaded = makeParsedConfig({'window:new': ['ctrl+n']});
    harness.setConfigForPhase('reload', reloaded);

    harness.emit({event: 'change', eventPath: path.join(directory, 'config.json5')});
    await settle();

    // The reload still applied that configuration; only its notice is withheld.
    expect(getCurrentConfig()).toBe(reloaded);
    expect(harness.notifyMock.mock.calls).toEqual([]);
  } finally {
    fs.rmSync(directory, {force: true, recursive: true});
  }
});

test.serial('a coalesced external keybindings change is announced despite the self-written config', async () => {
  const directory = writeSelfWrittenConfig();
  const harness = await createWatchHarness({configDir: directory});
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    // One debounced reload covers both files: the config still holds the
    // writer's text, but the keybindings file changed outside the settings tab.
    harness.setConfigForPhase('reload', makeParsedConfig({'window:new': ['ctrl+shift+n']}));

    harness.emit({event: 'change', eventPath: path.join(directory, 'config.json5')});
    await settle();

    expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock).toHaveBeenCalledWith('Configuration updated', 'Configuration reloaded!');
  } finally {
    fs.rmSync(directory, {force: true, recursive: true});
  }
});
