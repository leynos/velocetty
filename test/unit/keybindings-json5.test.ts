/** @file Covers JSON5 keybindings file import/export helpers. */
import {expect, mock, test} from 'bun:test';

import {createKeybindingsModule} from '../../app/config/keybindings';

const createInMemoryKeybindingsFile = (initialContent = '{}') => {
  let currentContent = initialContent;
  const writes: string[] = [];

  return {
    exists: true,
    getContent: () => currentContent,
    getWrites: () => writes,
    pathExists: () => true,
    readFile: (_path: string, _encoding: BufferEncoding) => currentContent,
    writeFile: (_path: string, content: string, _encoding: BufferEncoding) => {
      currentContent = content;
      writes.push(content);
    }
  };
};

test('importKeybindings accepts JSON5 comments and trailing commas, then exportKeybindings reuses the stored shape', () => {
  const file = createInMemoryKeybindingsFile();
  const keybindings = createKeybindingsModule({
    filePath: '/tmp/keybindings.json5',
    notify: mock((_message: string) => {}),
    pathExists: file.pathExists,
    readFile: file.readFile,
    writeFile: file.writeFile
  });

  const imported = keybindings.importKeybindings(
    `{
      // user overrides
      'window:new': ['ctrl+n',],
      'window:close': 'ctrl+w',
    }`,
    '/tmp/imported-keybindings.json5'
  );

  expect(imported.usedFallback).toBe(false);
  expect(imported.keymaps).toEqual({
    'window:new': ['ctrl+n'],
    'window:close': 'ctrl+w'
  });
  expect(file.getWrites()).toHaveLength(1);

  const exported = keybindings.exportKeybindings();
  expect(exported.usedFallback).toBe(false);
  expect(exported.keymaps).toEqual(imported.keymaps);
  expect(exported.content).toBe(file.getContent());
  expect(file.getContent()).toContain("'window:new'");
});

test('importKeybindings returns diagnostics and preserves the last known good keybindings on invalid JSON5', () => {
  const file = createInMemoryKeybindingsFile(`{'window:new': 'ctrl+n'}`);
  const notifyMock = mock((_message: string) => {});
  const keybindings = createKeybindingsModule({
    filePath: '/tmp/keybindings.json5',
    notify: notifyMock,
    pathExists: file.pathExists,
    readFile: file.readFile,
    writeFile: file.writeFile
  });

  keybindings.loadUserKeybindings();
  const imported = keybindings.importKeybindings(`{'window:new': 'ctrl+n'`);

  expect(imported.usedFallback).toBe(true);
  expect(imported.diagnostics).toHaveLength(1);
  expect(imported.keymaps).toEqual({'window:new': 'ctrl+n'});
  expect(file.getWrites()).toHaveLength(0);
  expect(notifyMock).not.toHaveBeenCalled();
});
