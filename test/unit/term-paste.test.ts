/**
 * @file Verifies Term routes clipboard paste through the main process.
 *
 * Invariants:
 * - Inactive terminals and paste events outside the terminal wrapper must be
 *   left to the native handler untouched.
 * - An intercepted paste always consumes the file-list command first and falls
 *   back to the text command, so the renderer never needs its own clipboard.
 *
 * Cross-links:
 * - Component: `lib/components/term.tsx`
 * - Harness: `test/testUtils/term-harness.ts`
 */
import {describe, expect, mock, spyOn, test} from 'bun:test';

import {withTermTestHarness} from '../testUtils/term-harness';

type PasteCapableTerm = {
  props: {isTermActive: boolean};
  term: {paste: (data: string) => void};
  termWrapperRef: HTMLElement | null;
  onWindowPaste: (e: Event) => void;
  pastePlatform: () => string;
  shouldInterceptFilePaste: () => boolean;
};

const createPasteEvent = (target: EventTarget) => {
  const event = new globalThis.Event('paste', {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'target', {value: target});
  return event;
};

/**
 * Builds a mounted terminal wrapper plus a Term instance wired to it.
 *
 * `shouldInterceptFilePaste` and `pastePlatform` are overridden per instance
 * rather than mocked at module level: the module registry is process-wide and
 * shared with concurrently running suites, and a quoting assertion must not
 * change meaning on the host that runs it.
 */
const buildPasteHarness = (termInstance: PasteCapableTerm, isTermActive: boolean) => {
  const termWrapperRef = document.createElement('div');
  const terminal = document.createElement('span');
  termWrapperRef.append(terminal);
  document.body.append(termWrapperRef);

  termInstance.props = {isTermActive};
  termInstance.termWrapperRef = termWrapperRef;
  termInstance.shouldInterceptFilePaste = () => true;
  termInstance.pastePlatform = () => 'darwin';
  const term = {paste: mock(() => {})};
  termInstance.term = term;
  return {term, termInstance, terminal, termWrapperRef};
};

/** Lets the awaited clipboard reads settle before assertions run. */
const flushClipboardReads = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Term clipboard paste routing', () => {
  test('leaves paste untouched when the term is inactive', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance<PasteCapableTerm>('uid-paste');
      const {terminal} = buildPasteHarness(termInstance, false);
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(false);
      expect(transportMock.invoke).not.toHaveBeenCalled();
    }));

  test('leaves paste untouched for events outside the terminal wrapper', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance<PasteCapableTerm>('uid-paste');
      buildPasteHarness(termInstance, true);
      const event = createPasteEvent(document.createElement('div'));

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(false);
      expect(transportMock.invoke).not.toHaveBeenCalled();
    }));

  test('prevents the native paste and writes clipboard text into the terminal', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance<PasteCapableTerm>('uid-paste');
      const {term, terminal} = buildPasteHarness(termInstance, true);
      transportMock.invoke.mockImplementation(async (channel: string) =>
        channel === 'clipboard.readFilePaths' ? [] : 'plain text'
      );
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(true);
      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readFilePaths');
      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readText');
      expect(term.paste).toHaveBeenCalledWith('plain text');
    }));

  test('pastes copied file paths without asking for clipboard text', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance<PasteCapableTerm>('uid-paste');
      const {term, terminal} = buildPasteHarness(termInstance, true);
      transportMock.invoke.mockImplementation(async (channel: string) =>
        channel === 'clipboard.readFilePaths' ? ['/tmp/a.txt'] : 'unused'
      );
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(true);
      expect(transportMock.invoke).not.toHaveBeenCalledWith('clipboard.readText');
      expect(term.paste).toHaveBeenCalledWith("'/tmp/a.txt'");
    }));

  test('pastes concurrent clipboard reads in the order they were requested', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance<PasteCapableTerm>('uid-paste');
      const {term, terminal} = buildPasteHarness(termInstance, true);
      const pasted: string[] = [];
      term.paste = mock((data: string) => {
        pasted.push(data);
      });

      // Text reads stay pending until released, so the test controls when each
      // paste observes its clipboard contents.
      const pendingTextReads: Array<(text: string) => void> = [];
      transportMock.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'clipboard.readFilePaths') return [];
        return new Promise<string>((resolve) => {
          pendingTextReads.push(resolve);
        });
      });

      const first = createPasteEvent(terminal);
      const second = createPasteEvent(terminal);
      termInstance.onWindowPaste(first);
      termInstance.onWindowPaste(second);
      await flushClipboardReads();

      // The queue must hold the second paste back while the first is reading.
      expect(pendingTextReads).toHaveLength(1);
      pendingTextReads[0]?.('first');
      await flushClipboardReads();
      expect(pasted).toEqual(['first']);

      // The queued paste runs now and opens its own text read.
      expect(pendingTextReads).toHaveLength(2);
      pendingTextReads[1]?.('second');
      await flushClipboardReads();
      expect(pasted).toEqual(['first', 'second']);
      expect(first.defaultPrevented).toBe(true);
      expect(second.defaultPrevented).toBe(true);
    }));

  test('falls back to clipboard text when the file-list read rejects', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance<PasteCapableTerm>('uid-paste');
      const {term, terminal} = buildPasteHarness(termInstance, true);
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      transportMock.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'clipboard.readFilePaths') {
          throw new Error('file list unavailable');
        }
        return 'plain text';
      });
      const event = createPasteEvent(terminal);

      try {
        termInstance.onWindowPaste(event);
        await flushClipboardReads();

        expect(event.defaultPrevented).toBe(true);
        expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readText');
        expect(term.paste).toHaveBeenCalledWith('plain text');
        expect(warnSpy).toHaveBeenCalledWith('Failed to read copied files from the clipboard.', expect.any(Error));
      } finally {
        warnSpy.mockRestore();
      }
    }));
});
