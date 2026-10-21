/** @file Verifies shell formatting of clipboard file paths for terminal paste. */
import {describe, expect, test} from 'bun:test';

import processClipboard, {quoteShellPaths, shouldInterceptFilePaste} from '../../lib/utils/paste';

describe('shouldInterceptFilePaste', () => {
  test('intercepts paste on platforms with a native file-list clipboard format', () => {
    expect(shouldInterceptFilePaste('darwin')).toBe(true);
    expect(shouldInterceptFilePaste('win32')).toBe(true);
  });

  test('leaves paste alone where the clipboard already yields paths as text', () => {
    expect(shouldInterceptFilePaste('linux')).toBe(false);
  });
});

describe('quoteShellPaths', () => {
  test('quotes each path so spaces survive shell word splitting', () => {
    expect(quoteShellPaths(['/tmp/a b.txt', '/tmp/c.txt'])).toBe("'/tmp/a b.txt' '/tmp/c.txt'");
  });

  test('escapes embedded single quotes', () => {
    expect(quoteShellPaths(["/tmp/it's.txt"])).toBe("'/tmp/it'\\''s.txt'");
  });

  test('returns an empty string when there are no paths', () => {
    expect(quoteShellPaths([])).toBe('');
  });
});

describe('processClipboard', () => {
  test('formats paths supplied by the clipboard reader', async () => {
    await expect(processClipboard(async () => ['/tmp/a.txt', '/tmp/b.txt'])).resolves.toBe("'/tmp/a.txt' '/tmp/b.txt'");
  });

  test('returns null when the clipboard holds no file list', async () => {
    await expect(processClipboard(async () => [])).resolves.toBeNull();
  });
});
