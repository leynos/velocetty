/** @file Verifies parsing of copied-file clipboard payloads into file paths. */
import {describe, expect, test} from 'bun:test';

import {CLIPBOARD_URI_LIST_MIME, parseUriList, readClipboardFilePaths} from '../../app/utils/clipboard-paths';
import type {ClipboardItemPort} from '../../app/utils/clipboard-paths';

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
  test('converts file URIs into absolute paths', () => {
    expect(parseUriList('file:///tmp/a%20b.txt\r\nfile:///tmp/c.txt')).toEqual(['/tmp/a b.txt', '/tmp/c.txt']);
  });

  test('accepts LF-only line endings and a trailing newline', () => {
    expect(parseUriList('file:///tmp/a.txt\nfile:///tmp/b.txt\n')).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
  });

  test('ignores comments and non-file URIs', () => {
    expect(parseUriList('# copied files\r\nfile:///tmp/a.txt\r\nhttps://example.com/b.txt')).toEqual(['/tmp/a.txt']);
  });

  test('ignores malformed URI lines rather than failing the whole paste', () => {
    expect(parseUriList('not a uri\r\nfile:///tmp/a.txt')).toEqual(['/tmp/a.txt']);
  });

  test('returns an empty list for empty input', () => {
    expect(parseUriList('')).toEqual([]);
  });
});

describe('readClipboardFilePaths', () => {
  test('reads the URI list payload as a Blob', async () => {
    const clipboard = createClipboard([createItem([CLIPBOARD_URI_LIST_MIME], new Blob(['file:///tmp/a.txt']))]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual(['/tmp/a.txt']);
  });

  test('reads a string payload', async () => {
    const clipboard = createClipboard([createItem([CLIPBOARD_URI_LIST_MIME], 'file:///tmp/a.txt')]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual(['/tmp/a.txt']);
  });

  test('skips items that do not publish the URI list type', async () => {
    const clipboard = createClipboard([
      createItem(['text/plain'], 'plain text'),
      createItem([CLIPBOARD_URI_LIST_MIME], 'file:///tmp/a.txt')
    ]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual(['/tmp/a.txt']);
  });

  test('returns an empty list when no item carries a file list', async () => {
    const clipboard = createClipboard([createItem(['text/plain'], 'plain text')]);

    await expect(readClipboardFilePaths(clipboard)).resolves.toEqual([]);
  });

  test('returns an empty list for an empty clipboard', async () => {
    await expect(readClipboardFilePaths({read: async () => []})).resolves.toEqual([]);
  });
});
