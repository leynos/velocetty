/**
 * @file Verifies Term quick-edit copy and paste use the main-process clipboard.
 *
 * Electron 44 removed the renderer `clipboard` module (RFC 0019), so the
 * component must route both directions through the transport instead of
 * reaching for a renderer-side clipboard API.
 *
 * Cross-links:
 * - Component: `lib/components/term.tsx`
 * - Harness: `test/testUtils/term-harness.ts`
 */
import {describe, expect, mock, spyOn, test} from 'bun:test';

import {withTermTestHarness} from '../testUtils/term-harness';

type QuickEditTerm = {
  props: {quickEdit: boolean; copyOnSelect: boolean};
  term: {
    hasSelection: () => boolean;
    getSelection: () => string;
    clearSelection: () => void;
    paste: (data: string) => void;
  };
  onMouseUp: (e: React.MouseEvent) => void;
};

const rightClick = () => ({button: 2}) as React.MouseEvent;

/** Builds a Term instance whose terminal reports `hasSelection`. */
const buildQuickEditHarness = (termInstance: QuickEditTerm, hasSelection: boolean) => {
  termInstance.props = {quickEdit: true, copyOnSelect: false};
  termInstance.term = {
    hasSelection: () => hasSelection,
    getSelection: () => 'selected text',
    clearSelection: mock(() => {}),
    paste: mock(() => {})
  };
  return termInstance;
};

/** Lets the awaited clipboard reads settle before assertions run. */
const flushClipboardReads = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Term quick-edit clipboard routing', () => {
  test('copies the selection through the main process when one exists', () =>
    withTermTestHarness(({createTermInstance, transportMock}) => {
      const termInstance = buildQuickEditHarness(
        createTermInstance('uid-quick-edit') as unknown as QuickEditTerm,
        true
      );

      termInstance.onMouseUp(rightClick());

      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.writeText', 'selected text');
      expect(termInstance.term.clearSelection).toHaveBeenCalledTimes(1);
      expect(transportMock.invoke).not.toHaveBeenCalledWith('clipboard.readText');
    }));

  test('pastes clipboard text when quick edit finds no selection', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = buildQuickEditHarness(
        createTermInstance('uid-quick-edit') as unknown as QuickEditTerm,
        false
      );
      transportMock.invoke.mockImplementation(async () => 'clipboard text');

      termInstance.onMouseUp(rightClick());
      await flushClipboardReads();

      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readText');
      expect(termInstance.term.paste).toHaveBeenCalledWith('clipboard text');
    }));

  test('logs rather than rethrows when the copy write rejects', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = buildQuickEditHarness(
        createTermInstance('uid-quick-edit') as unknown as QuickEditTerm,
        true
      );
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      transportMock.invoke.mockImplementation(async () => {
        throw new Error('ipc unavailable');
      });

      try {
        termInstance.onMouseUp(rightClick());
        await flushClipboardReads();

        expect(warnSpy).toHaveBeenCalledWith('Failed to copy the selection to the clipboard.', expect.any(Error));
        expect(termInstance.term.clearSelection).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    }));
});
