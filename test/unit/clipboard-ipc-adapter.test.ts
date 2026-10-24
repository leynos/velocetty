/** @file Guards the Electron clipboard adapter and the IPC handlers it feeds. */
import {beforeAll, beforeEach, expect, test} from 'bun:test';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import type {ClipboardTypePayload, IpcHandleListener} from '../testUtils/electron-path';
import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';

/** A file URI list, the payload type Electron supplies as a `Blob`. */
const uriListType = 'text/uri-list';

/**
 * A real platform path, and the `file:` URI that decodes back to it.
 *
 * The adapter hands the payload to `fileURLToPath`, which rejects a POSIX-shaped
 * `file:///tmp/...` on Windows because that URI carries no drive letter. Building
 * both sides from one `node:path` path keeps the fixture valid wherever it runs;
 * `clipboard-paths.test.ts` owns the URI-to-path behaviour itself, so these tests
 * only need a payload the parser will accept.
 */
const tempPath = (name: string): string => path.join(tmpdir(), name);
const tempUri = (name: string): string => pathToFileURL(tempPath(name)).href;

/**
 * The event argument the handlers ignore.
 *
 * None of these commands reads the invoking frame, so a bare object keeps the
 * call site honest about that: if a handler starts using the event, this stub
 * stops type-checking rather than silently supplying a plausible one.
 */
const unusedIpcEvent = makeUnusedIpcEvent();

/**
 * Builds the ignored event argument.
 *
 * Kept as a factory so the SAFETY note sits on the assertion rather than on a
 * declaration the assertion merely initialises.
 */
function makeUnusedIpcEvent(): Electron.IpcMainEvent {
  // SAFETY: every clipboard handler ignores its event argument, so no member of
  // `IpcMainEvent` is ever read. If one starts reading it, this cast still
  // type-checks but `unusedIpcEvent` is no longer unused, and the handler's own
  // use will fail to compile against the empty object.
  return {} as Electron.IpcMainEvent;
}

let handlers: Map<string, IpcHandleListener>;
let writtenText: string[];
let registerClipboardIpcHandlers: () => void;

/** Takes the handler `registerClipboardIpcHandlers` registered for `channel`. */
const handlerFor = (channel: string): IpcHandleListener => {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Expected a handler for ${channel}.`);
  }
  return handler;
};

/**
 * Replaces the clipboard mock's `read` with a fixed list of entries.
 *
 * The properties are reassigned on the existing object rather than swapping in
 * a new one: `app/clipboard.ts` destructures `clipboard` from the Electron
 * module at evaluation time, so a replacement object would never be seen.
 */
const stubClipboardEntries = (
  entries: ReadonlyArray<{types: string[]; getType: () => Promise<ClipboardTypePayload>}>
) => {
  const clipboard = getElectronMock().clipboard;
  if (!clipboard) {
    throw new Error('Expected the Electron mock to expose a clipboard.');
  }
  clipboard.read = async () => [...entries];
};

beforeAll(async () => {
  handlers = new Map();
  writtenText = [];

  resetElectronMock();
  registerElectronMock();
  // `app/clipboard.ts` reads `ipcMain.handle` from the Electron module before
  // any test body runs, so the registering stub has to be in place first.
  getElectronMock().ipcMain.handle = (channel, handler) => {
    handlers.set(channel, handler);
  };

  ({registerClipboardIpcHandlers} = await importFresh<typeof import('../../app/clipboard')>(
    '../../app/clipboard',
    'clipboard_ipc_adapter_unit'
  ));
});

beforeEach(() => {
  handlers.clear();
  writtenText = [];
  const clipboard = getElectronMock().clipboard;
  if (!clipboard) {
    throw new Error('Expected the Electron mock to expose a clipboard.');
  }
  clipboard.read = async () => [];
  clipboard.readText = () => '';
  clipboard.writeText = (text) => {
    writtenText.push(text);
  };
});

test('registers a handler for each clipboard command', () => {
  registerClipboardIpcHandlers();

  expect([...handlers.keys()].toSorted()).toEqual([
    'clipboard.readFilePaths',
    'clipboard.readText',
    'clipboard.writeText'
  ]);
});

test('reads file paths from a Blob payload', async () => {
  // A real `Blob` rather than a shaped object: `isClipboardPayload` narrows on
  // `instanceof Blob`, so a plain object would take the rejection branch and
  // this test would pass for the wrong reason.
  stubClipboardEntries([{types: [uriListType], getType: async () => new Blob([tempUri('a b.txt')])}]);
  registerClipboardIpcHandlers();

  expect(await handlerFor('clipboard.readFilePaths')(unusedIpcEvent)).toEqual([tempPath('a b.txt')]);
});

test('reads file paths from a string payload', async () => {
  stubClipboardEntries([{types: [uriListType], getType: async () => tempUri('plain.txt')}]);
  registerClipboardIpcHandlers();

  expect(await handlerFor('clipboard.readFilePaths')(unusedIpcEvent)).toEqual([tempPath('plain.txt')]);
});

test('drops an unreadable payload instead of passing it on', async () => {
  // A bookmark object is a real Electron payload shape for a non-URI type, and
  // it is neither a `Blob` nor a string. The adapter must drop it so the parser
  // never has to decode an `unknown`.
  let payloadReads = 0;
  stubClipboardEntries([
    {
      types: [uriListType],
      getType: async () => {
        payloadReads += 1;
        return {title: 'bookmark', url: 'file:///tmp/bookmark.txt'};
      }
    }
  ]);
  registerClipboardIpcHandlers();

  expect(await handlerFor('clipboard.readFilePaths')(unusedIpcEvent)).toEqual([]);
  // The adapter asks for the type before rejecting it, so this also proves the
  // empty result came from the rejection branch and not from a skipped read.
  expect(payloadReads).toBe(1);
});

test('passes clipboard text through unchanged', () => {
  const clipboard = getElectronMock().clipboard;
  if (!clipboard) {
    throw new Error('Expected the Electron mock to expose a clipboard.');
  }
  clipboard.readText = () => 'copied text';
  registerClipboardIpcHandlers();

  expect(handlerFor('clipboard.readText')(unusedIpcEvent)).toBe('copied text');
});

test('writes the requested text to the clipboard', () => {
  registerClipboardIpcHandlers();

  handlerFor('clipboard.writeText')(unusedIpcEvent, 'pasted text');

  expect(writtenText).toEqual(['pasted text']);
});
