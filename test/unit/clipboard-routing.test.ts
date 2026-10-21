/**
 * @file Verifies the terminal clipboard routing helpers.
 *
 * Invariants:
 * - A copied file list wins over plain text and is formatted for the caller's
 *   platform.
 * - A failed file-list read still yields the clipboard text, so a paste is
 *   never silently dropped.
 * - A failed copy is logged rather than thrown, because copy is fire-and-forget.
 *
 * Cross-links:
 * - Module: `lib/utils/clipboard-routing.ts`
 * - Component: `lib/components/term.tsx`
 */
import {describe, expect, spyOn, test} from 'bun:test';

import {copyText, readPastePayload} from '../../lib/utils/clipboard-routing';

/** Runs `body` with `console.warn` captured so expected logs stay quiet. */
const capturingWarnings = async (body: (warnings: unknown[][]) => Promise<void>) => {
  const warnings: unknown[][] = [];
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });

  try {
    await body(warnings);
  } finally {
    warnSpy.mockRestore();
  }
};

describe('readPastePayload', () => {
  test('formats copied file paths for the given platform', async () => {
    const payload = await readPastePayload(
      {readFilePaths: async () => ['/tmp/a b.txt'], readText: async () => 'unused'},
      'darwin'
    );

    expect(payload).toBe("'/tmp/a b.txt'");
  });

  test('does not read clipboard text when file paths were found', async () => {
    let textReads = 0;

    await readPastePayload(
      {
        readFilePaths: async () => ['/tmp/a.txt'],
        readText: async () => {
          textReads += 1;
          return 'unused';
        }
      },
      'darwin'
    );

    expect(textReads).toBe(0);
  });

  test('falls back to clipboard text when no file paths were copied', async () => {
    const payload = await readPastePayload({readFilePaths: async () => [], readText: async () => 'plain'}, 'darwin');

    expect(payload).toBe('plain');
  });

  test('falls back to clipboard text and warns when the file-list read rejects', async () => {
    await capturingWarnings(async (warnings) => {
      const payload = await readPastePayload(
        {
          readFilePaths: async () => {
            throw new Error('no clipboard');
          },
          readText: async () => 'plain'
        },
        'darwin'
      );

      expect(payload).toBe('plain');
      expect(warnings).toEqual([['Failed to read copied files from the clipboard.', expect.any(Error)]]);
    });
  });
});

describe('copyText', () => {
  test('writes the selection through the supplied port', async () => {
    const written: string[] = [];

    await copyText(async (text) => {
      written.push(text);
    }, 'selection');

    expect(written).toEqual(['selection']);
  });

  test('warns instead of rejecting when the write fails', async () => {
    await capturingWarnings(async (warnings) => {
      await copyText(async () => {
        throw new Error('ipc unavailable');
      }, 'selection');

      expect(warnings).toEqual([['Failed to copy the selection to the clipboard.', expect.any(Error)]]);
    });
  });
});
