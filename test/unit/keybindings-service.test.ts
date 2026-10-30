/** @file Named examples for the keybindings service: start, reload, import, export. */
import {describe, expect, test} from 'bun:test';

import type {ConfigImportNotify} from '../../app/config/keybindings';
import {createKeybindingsService} from '../../app/config/keybindings';
import {parseKeybindingsText, serializeKeybindings} from '../../app/config/keybindings-codec';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import {createMemoryKeybindingsStore} from '../testUtils/memory-keybindings-store';

const KEYMAPS_A: UserKeymaps = {'window:new': 'ctrl+n'};
const KEYMAPS_B: UserKeymaps = {'window:close': 'ctrl+w'};
const VALID_TEXT = serializeKeybindings(KEYMAPS_B);
const INVALID_TEXT = '{broken';
const OTHER_INVALID_TEXT = '[1, 2]';

type Notified = {
  readonly title: string;
  readonly body: string | undefined;
  readonly details: {readonly error?: unknown} | undefined;
};

const createNotifier = () => {
  const calls: Notified[] = [];
  const notify: ConfigImportNotify = (title, body, details) => {
    calls.push({body, details, title});
  };
  return {calls, notify};
};

const lastCall = (calls: readonly Notified[]): Notified | undefined => calls.at(-1);

const setup = (initialText?: string) => {
  const store = createMemoryKeybindingsStore();
  if (initialText !== undefined) {
    store.setText(initialText);
  }
  const notifier = createNotifier();
  const service = createKeybindingsService({notify: notifier.notify, store});
  return {...notifier, service, store};
};

describe('start', () => {
  test('seeds a missing file from parsed legacy keymaps', () => {
    const {calls, service, store} = setup();

    const outcome = service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    expect(outcome).toEqual({keymaps: KEYMAPS_A, kind: 'applied', origin: 'seeded'});
    expect(store.writtenTexts()).toEqual([serializeKeybindings(KEYMAPS_A)]);
    expect(calls).toEqual([]);
  });

  test('seeds an empty file when the legacy source carries no keymaps', () => {
    const {service, store} = setup();

    const outcome = service.start({kind: 'parsed-empty'});

    expect(outcome).toEqual({keymaps: {}, kind: 'applied', origin: 'seeded'});
    expect(store.writtenTexts()).toEqual([serializeKeybindings({})]);
  });

  test('defers an invalid legacy source without writing', () => {
    const {service, store} = setup();

    const outcome = service.start({kind: 'parsed-invalid'});

    expect(outcome).toEqual({basis: 'empty', cause: 'deferred', diagnostics: [], keymaps: {}, kind: 'kept'});
    expect(store.writeAttempts()).toBe(0);
  });

  test('applies an existing file and never overwrites it', () => {
    const {service, store} = setup(VALID_TEXT);

    const outcome = service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    expect(outcome).toEqual({keymaps: KEYMAPS_B, kind: 'applied', origin: 'file'});
    expect(store.writeAttempts()).toBe(0);
  });

  test('keeps the default shortcuts when the file is unreadable', () => {
    const {calls, service, store} = setup();
    store.setUnreadable();

    const outcome = service.start({kind: 'parsed-empty'});

    expect(outcome).toMatchObject({basis: 'empty', cause: 'unreadable', keymaps: {}, kind: 'kept'});
    expect(store.writeAttempts()).toBe(0);
    expect(calls.map((call) => call.title).join(' ')).toContain('Using default shortcuts until the file is fixed');
  });

  test('bootstraps at most once', () => {
    const {service, store} = setup();

    service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});
    const second = service.start({keymaps: KEYMAPS_B, kind: 'parsed-keymaps'});

    expect(store.writeAttempts()).toBe(1);
    expect(second).toMatchObject({keymaps: KEYMAPS_A, kind: 'applied'});
  });
});

describe('reload', () => {
  test('keeps the last known good and says so', () => {
    const {calls, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setText(INVALID_TEXT);

    const outcome = service.reload();

    expect(outcome).toMatchObject({
      basis: 'last-known-good',
      cause: 'invalid',
      keymaps: KEYMAPS_A,
      kind: 'kept'
    });
    expect(calls.map((call) => call.title).join(' ')).toContain('Keeping your previous shortcuts');
    expect(store.writeAttempts()).toBe(0);
  });

  test('keeps the accepted file keymaps, not the legacy ones, when the file turns invalid', () => {
    // The pull request #67 defect: the reload fallback applied the legacy
    // keymaps. Legacy keymaps differing from the file make the coincidence
    // that hid the bug impossible.
    const {service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({keymaps: KEYMAPS_B, kind: 'parsed-keymaps'});
    store.setText(INVALID_TEXT);

    const outcome = service.reload();

    const active = service.active();
    expect(outcome).toMatchObject({keymaps: KEYMAPS_A, kind: 'kept'});
    expect(active).toEqual(KEYMAPS_A);
    expect(active).not.toEqual(KEYMAPS_B);
  });

  test('applies the empty map when a deleted file is reloaded', () => {
    const {service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setMissing();

    const outcome = service.reload();

    expect(outcome).toEqual({keymaps: {}, kind: 'applied', origin: 'missing'});
    expect(store.writeAttempts()).toBe(0);
  });

  test('treats a missing file as an accepted empty map', () => {
    const {calls, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setMissing();
    service.reload();
    store.setText(INVALID_TEXT);

    const outcome = service.reload();

    // `missing` is an accepted observation in the policy, so the rejected read
    // that follows is backed by a last-known-good payload (the empty map).
    expect(outcome).toMatchObject({basis: 'last-known-good', cause: 'invalid', kind: 'kept'});
    expect(lastCall(calls)?.title).toContain('Keeping your previous shortcuts');
  });

  test('shows an unchanged diagnostic only once', () => {
    const {calls, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setText(INVALID_TEXT);

    service.reload();
    service.reload();

    expect(calls).toHaveLength(1);
  });

  test('shows a changed diagnostic again', () => {
    const {calls, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setText(INVALID_TEXT);
    service.reload();
    store.setText(OTHER_INVALID_TEXT);

    service.reload();

    expect(calls).toHaveLength(2);
  });
});

describe('importKeybindings', () => {
  test('writes the text verbatim and leaves the active keymaps until reload', () => {
    const {service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});

    expect(service.importKeybindings(VALID_TEXT, 'import.json5')).toEqual({kind: 'written'});
    expect(store.writtenTexts()).toEqual([VALID_TEXT]);

    const outcome = service.reload();
    expect(outcome).toMatchObject({keymaps: KEYMAPS_B, kind: 'applied'});
  });

  test('rejects invalid text without writing', () => {
    const {service, store} = setup(VALID_TEXT);
    service.start({kind: 'parsed-empty'});
    const expected = parseKeybindingsText(INVALID_TEXT, 'import.json5');

    const outcome = service.importKeybindings(INVALID_TEXT, 'import.json5');

    expect(outcome).toEqual(
      expected.kind === 'invalid' ? {diagnostics: expected.diagnostics, kind: 'invalid'} : {kind: 'written'}
    );
    expect(store.writeAttempts()).toBe(0);
  });

  test('reports a failed write and notifies', () => {
    const {calls, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.failNextWrite(new Error('disk full'));

    const outcome = service.importKeybindings(VALID_TEXT, 'import.json5');

    expect(outcome.kind).toBe('failed');
    expect(store.writeAttempts()).toBe(1);
    expect(store.writtenTexts()).toEqual([]);
    expect(lastCall(calls)?.title).toContain("Couldn't save keybindings file");
  });
});

describe('exportKeybindings', () => {
  test('returns the stored text verbatim', () => {
    const {calls, service, store} = setup(VALID_TEXT);
    service.start({kind: 'parsed-empty'});

    expect(service.exportKeybindings()).toEqual({kind: 'stored', text: VALID_TEXT});
    expect(store.writeAttempts()).toBe(0);
    expect(calls).toEqual([]);
  });

  test('returns invalid text with diagnostics', () => {
    const {service} = setup(INVALID_TEXT);

    const outcome = service.exportKeybindings();
    const expected = parseKeybindingsText(INVALID_TEXT, 'memory-keybindings.json5');

    expect(outcome).toMatchObject({kind: 'invalid', text: INVALID_TEXT});
    if (outcome.kind === 'invalid' && expected.kind === 'invalid') {
      expect(outcome.diagnostics).toEqual(expected.diagnostics);
    }
  });

  test('reports a missing file', () => {
    const {service} = setup();

    expect(service.exportKeybindings()).toEqual({kind: 'missing'});
  });

  test('reports an unreadable file', () => {
    const {service, store} = setup();
    store.setUnreadable();

    expect(service.exportKeybindings()).toMatchObject({kind: 'unreadable'});
  });
});
