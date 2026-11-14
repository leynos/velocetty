/**
 * @file Asserts the keybindings service's command paths drive their injected ports.
 *
 * The behavioural examples pin what each command returns; these pin the other
 * half of the contract — which port receives which argument. A service that
 * reached past a port, ignored the codec's label, or wrote without reporting
 * could still satisfy the behavioural suite.
 *
 * Cross-links:
 * - Service: `app/config/keybindings.ts`
 * - Ports: `app/config/keybindings-ports.ts`
 */
import {describe, expect, mock, test} from 'bun:test';

import {createKeybindingsService} from '../../app/config/keybindings';
import type {
  KeybindingsNotice,
  KeybindingsReadOutcome,
  KeybindingsStore,
  KeybindingsTextCodec
} from '../../app/config/keybindings-ports';
import type {UserKeymaps} from '../../app/config/keybindings-policy';

const KEYMAPS: UserKeymaps = {'window:new': 'ctrl+n'};
const STORED_TEXT = '{"window:close": "ctrl+w"}\n';
const IMPORTED_TEXT = '{"window:close": "ctrl+q"}\n';
const SERIALIZED_TEXT = 'serialized by the codec\n';

/** What the codec reports for a parse, so a test can choose ok or invalid. */
type ParsedText = ReturnType<KeybindingsTextCodec['parse']>;

/** What the store reports for a write, so a test can choose success or failure. */
type WriteOutcome = ReturnType<KeybindingsStore['write']>;

/** The ports one example drives, with every call and argument recorded. */
const createRecordingPorts = (options: {
  readonly read: KeybindingsReadOutcome;
  readonly parsed?: ParsedText;
  readonly written?: WriteOutcome;
}) => {
  const notices: KeybindingsNotice[] = [];
  const parsed = options.parsed ?? {keymaps: KEYMAPS, kind: 'ok'};
  const written = options.written ?? {kind: 'written'};
  const codec = {
    parse: mock((_text: string, _label: string): ParsedText => parsed),
    serialize: mock((_keymaps: UserKeymaps): string => SERIALIZED_TEXT)
  };
  const store = {
    label: 'recording.json5',
    peek: mock((): KeybindingsReadOutcome => options.read),
    read: mock((): KeybindingsReadOutcome => options.read),
    write: mock((_text: string): WriteOutcome => written)
  };
  const report = mock((notice: KeybindingsNotice) => {
    notices.push(notice);
  });
  return {codec, notices, report, store};
};

/** Builds the service over the recording ports, which the caller keeps for assertions. */
const serviceOver = (ports: ReturnType<typeof createRecordingPorts>) =>
  createKeybindingsService({codec: ports.codec, report: ports.report, store: ports.store});

describe('start', () => {
  test('serializes the seed through the codec before writing it', () => {
    const ports = createRecordingPorts({read: {kind: 'missing'}});

    const outcome = serviceOver(ports).start({keymaps: KEYMAPS, kind: 'parsed-keymaps'});

    // The argument is the decision's keymaps, and the written text is whatever
    // the codec produced rather than anything the service formats itself.
    expect(ports.codec.serialize.mock.calls[0]?.[0]).toEqual(KEYMAPS);
    expect(ports.store.write.mock.calls).toEqual([[SERIALIZED_TEXT]]);
    expect(outcome).toEqual({
      keymaps: KEYMAPS,
      kind: 'applied',
      origin: 'seeded',
      writtenText: SERIALIZED_TEXT
    });
  });
});

describe('importKeybindings', () => {
  test('validates the request text through the codec, then writes it verbatim', () => {
    const ports = createRecordingPorts({read: {kind: 'present', text: STORED_TEXT}});

    const outcome = serviceOver(ports).importKeybindings({sourceLabel: 'import.json5', text: IMPORTED_TEXT});

    // The codec receives both the text and the label its diagnostics should cite.
    expect(ports.codec.parse.mock.calls[0]).toEqual([IMPORTED_TEXT, 'import.json5']);
    expect(ports.store.write.mock.calls).toEqual([[IMPORTED_TEXT]]);
    expect(ports.report).not.toHaveBeenCalled();
    expect(outcome).toEqual({kind: 'written'});
  });

  test('returns the codec diagnostics and writes nothing when the text is invalid', () => {
    const diagnostics = [{message: 'expected an object', path: '/', suggestedFix: 'use {}'}];
    const ports = createRecordingPorts({
      parsed: {diagnostics, kind: 'invalid'},
      read: {kind: 'present', text: STORED_TEXT}
    });

    const outcome = serviceOver(ports).importKeybindings({sourceLabel: 'import.json5', text: IMPORTED_TEXT});

    expect(outcome).toEqual({diagnostics, kind: 'invalid'});
    expect(ports.store.write).not.toHaveBeenCalled();
    expect(ports.report).not.toHaveBeenCalled();
  });

  test('reports a failed write through the reporter, not the outcome alone', () => {
    const ports = createRecordingPorts({
      read: {kind: 'present', text: STORED_TEXT},
      written: {failure: 'permission', kind: 'failed'}
    });

    const outcome = serviceOver(ports).importKeybindings({sourceLabel: 'import.json5', text: IMPORTED_TEXT});

    expect(outcome).toEqual({failure: 'permission', kind: 'failed'});
    expect(ports.store.write.mock.calls).toEqual([[IMPORTED_TEXT]]);
    expect(ports.report.mock.calls).toEqual([[{failure: 'permission', kind: 'import-failed'}]]);
  });
});

describe('exportKeybindings', () => {
  test('reads without a span or warning and validates under the store label', () => {
    const ports = createRecordingPorts({read: {kind: 'present', text: STORED_TEXT}});

    const outcome = serviceOver(ports).exportKeybindings();

    // Export is a query: it peeks, never performs the instrumented read, and
    // never writes.
    expect(ports.store.peek).toHaveBeenCalledTimes(1);
    expect(ports.store.read).not.toHaveBeenCalled();
    expect(ports.store.write).not.toHaveBeenCalled();
    expect(ports.codec.parse.mock.calls[0]).toEqual([STORED_TEXT, 'recording.json5']);
    expect(outcome).toEqual({kind: 'stored', text: STORED_TEXT});
  });

  test('reports a missing file without consulting the codec', () => {
    const ports = createRecordingPorts({read: {kind: 'missing'}});

    const outcome = serviceOver(ports).exportKeybindings();

    expect(outcome).toEqual({kind: 'missing'});
    expect(ports.codec.parse).not.toHaveBeenCalled();
    expect(ports.report).not.toHaveBeenCalled();
  });
});
