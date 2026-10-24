/**
 * @file Verifies parsing of copied-file clipboard payloads into file paths.
 *
 * File URL handling is platform-sensitive: a POSIX-shaped `file:///tmp/a.txt`
 * is not a valid local file URL on Windows. Inputs are therefore built with
 * `pathToFileURL` from real platform paths, and expectations from `node:path`,
 * so the suite tests the same behaviour on every CI platform.
 *
 * Cross-links:
 * - Source: `app/utils/clipboard-paths.ts`
 */
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

import {describe, expect, test} from 'bun:test';

import {CLIPBOARD_URI_LIST_MIME, parseUriList, readClipboardFilePaths} from '../../app/utils/clipboard-paths';
import type {ClipboardItemPort} from '../../app/utils/clipboard-paths';

/** Absolute path in the platform temp directory. */
const tempPath = (name: string): string => path.join(tmpdir(), name);

/** `file:` URL whose decoded path is `tempPath(name)`. */
const tempUri = (name: string): URL => pathToFileURL(tempPath(name));

const createItem = (types: string[], payload: string | Blob): ClipboardItemPort => ({
  types,
  getType: async (type: string) => {
    if (!types.includes(type)) {
      throw new Error(`Clipboard item does not provide ${type}`);
    }
    return payload;
  }
});

const createClipboard = (items: ClipboardItemPort[]) => ({
  read: async () => items
});

describe('parseUriList', () => {
  test('converts file URIs into absolute paths, decoding escapes', () => {
    expect(parseUriList([tempUri('a b.txt').href, tempUri('c.txt').href].join('\r\n'))).toEqual([
      tempPath('a b.txt'),
      tempPath('c.txt')
    ]);
  });

  test('accepts LF-only line endings and a trailing newline', () => {
    const uriList = [tempUri('a.txt').href, tempUri('b.txt').href].join('\n');

    expect(parseUriList(`${uriList}\n`)).toEqual([tempPath('a.txt'), tempPath('b.txt')]);
  });

  test('ignores comments and non-file URIs', () => {
    const uriList = `# copied files\r\n${tempUri('a.txt').href}\r\nhttps://example.com/b.txt`;

    expect(parseUriList(uriList)).toEqual([tempPath('a.txt')]);
  });

  test('ignores malformed URI lines rather than failing the whole paste', () => {
    expect(parseUriList(`not a uri\r\n${tempUri('a.txt').href}`)).toEqual([tempPath('a.txt')]);
  });

  test('returns an empty list for empty input', () => {
    expect(parseUriList('')).toEqual([]);
  });
});

describe('readClipboardFilePaths', () => {
  const expectedPaths = [tempPath('a.txt')];

  test('reads the URI list payload as a Blob', async () => {
    const payload = new Blob([tempUri('a.txt').href]);
    const clipboard = createClipboard([createItem([CLIPBOARD_URI_LIST_MIME], payload)]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual(expectedPaths);
  });

  test('reads a string payload', async () => {
    const clipboard = createClipboard([createItem([CLIPBOARD_URI_LIST_MIME], tempUri('a.txt').href)]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual(expectedPaths);
  });

  test('skips items that do not publish the URI list type', async () => {
    const clipboard = createClipboard([
      createItem(['text/plain'], 'plain text'),
      createItem([CLIPBOARD_URI_LIST_MIME], tempUri('a.txt').href)
    ]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual(expectedPaths);
  });

  test('returns an empty list when no item carries a file list', async () => {
    const clipboard = createClipboard([createItem(['text/plain'], 'plain text')]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual([]);
  });

  test('returns an empty list for an empty clipboard', async () => {
    await expect(readClipboardFilePaths({read: async () => []})).resolves.toEqual([]);
  });
});
