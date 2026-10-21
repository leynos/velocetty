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
  test('quotes each path so spaces survive POSIX shell word splitting', () => {
    expect(quoteShellPaths(['/tmp/a b.txt', '/tmp/c.txt'], 'darwin')).toBe("'/tmp/a b.txt' '/tmp/c.txt'");
  });

  test('escapes embedded single quotes for POSIX shells', () => {
    expect(quoteShellPaths(["/tmp/it's.txt"], 'darwin')).toBe("'/tmp/it'\\''s.txt'");
  });

  test('uses double quotes on win32, where single quotes are literal', () => {
    expect(quoteShellPaths(['C:\\a b.txt', 'C:\\c.txt'], 'win32')).toBe('"C:\\a b.txt" "C:\\c.txt"');
  });

  test('keeps an embedded single quote literal on win32', () => {
    expect(quoteShellPaths(["C:\\it's.txt"], 'win32')).toBe('"C:\\it\'s.txt"');
  });

  test('returns an empty string when there are no paths', () => {
    expect(quoteShellPaths([], 'darwin')).toBe('');
  });
});

describe('processClipboard', () => {
  test('formats paths supplied by the clipboard reader', async () => {
    await expect(processClipboard(async () => ['/tmp/a.txt', '/tmp/b.txt'], 'darwin')).resolves.toBe(
      "'/tmp/a.txt' '/tmp/b.txt'"
    );
  });

  test('formats Windows paths with Windows quoting', async () => {
    await expect(processClipboard(async () => ['C:\\a b.txt'], 'win32')).resolves.toBe('"C:\\a b.txt"');
  });

  test('returns null when the clipboard holds no file list', async () => {
    await expect(processClipboard(async () => [], 'darwin')).resolves.toBeNull();
  });
});
