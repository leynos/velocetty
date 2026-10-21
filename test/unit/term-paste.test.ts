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
import {describe, expect, mock, test} from 'bun:test';

import {withTermTestHarness} from '../testUtils/term-harness';

type PasteCapableTerm = {
  props: {isTermActive: boolean};
  term: {paste: (data: string) => void};
  termWrapperRef: HTMLElement | null;
  onWindowPaste: (e: Event) => void;
  shouldInterceptFilePaste: () => boolean;
};

const createPasteEvent = (target: EventTarget) => {
  const event = new window.Event('paste', {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'target', {value: target});
  return event;
};

/**
 * Builds a mounted terminal wrapper plus a Term instance wired to it.
 *
 * `shouldInterceptFilePaste` is overridden per instance rather than mocked at
 * module level: the module registry is process-wide and shared with
 * concurrently running suites.
 */
const buildPasteHarness = (termInstance: PasteCapableTerm, isTermActive: boolean) => {
  const termWrapperRef = document.createElement('div');
  const terminal = document.createElement('span');
  termWrapperRef.appendChild(terminal);
  document.body.appendChild(termWrapperRef);

  termInstance.props = {isTermActive};
  termInstance.termWrapperRef = termWrapperRef;
  termInstance.shouldInterceptFilePaste = () => true;
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
      const termInstance = createTermInstance('uid-paste') as unknown as PasteCapableTerm;
      const {terminal} = buildPasteHarness(termInstance, false);
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(false);
      expect(transportMock.invoke).not.toHaveBeenCalled();
    }));

  test('leaves paste untouched for events outside the terminal wrapper', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance('uid-paste') as unknown as PasteCapableTerm;
      buildPasteHarness(termInstance, true);
      const event = createPasteEvent(document.createElement('div'));

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(false);
      expect(transportMock.invoke).not.toHaveBeenCalled();
    }));

  test('prevents the native paste and writes clipboard text into the terminal', () =>
    withTermTestHarness(async ({createTermInstance, transportMock}) => {
      const termInstance = createTermInstance('uid-paste') as unknown as PasteCapableTerm;
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
      const termInstance = createTermInstance('uid-paste') as unknown as PasteCapableTerm;
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
});
