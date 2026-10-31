/** @file Named examples for the keybindings service: start, reload, import, export. */
import {describe, expect, test} from 'bun:test';

import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import type {ConfigImportNotify} from '../../app/config/keybindings';
import {createKeybindingsService} from '../../app/config/keybindings';
import {parseKeybindingsText, serializeKeybindings} from '../../app/config/keybindings-codec';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import {createFileKeybindingsStore} from '../../app/config/keybindings-store';
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

  test('reports an unsaved seed when the write fails', () => {
    const {calls, service, store} = setup();
    store.failNextWrite(new Error('disk full'));

    const outcome = service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    // The shortcut set still takes effect for this session, but nothing reached
    // the disk, so the origin distinguishes it from a completed migration.
    expect(outcome).toEqual({keymaps: KEYMAPS_A, kind: 'applied', origin: 'seeded-unsaved'});
    expect(store.writtenTexts()).toEqual([]);
    expect(lastCall(calls)?.title).toContain("Couldn't create a keybindings file");
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

    expect(service.importKeybindings({sourceLabel: 'import.json5', text: VALID_TEXT})).toEqual({kind: 'written'});
    expect(store.writtenTexts()).toEqual([VALID_TEXT]);

    const outcome = service.reload();
    expect(outcome).toMatchObject({keymaps: KEYMAPS_B, kind: 'applied'});
  });

  test('rejects invalid text without writing', () => {
    const {service, store} = setup(VALID_TEXT);
    service.start({kind: 'parsed-empty'});
    const expected = parseKeybindingsText(INVALID_TEXT, 'import.json5');

    const outcome = service.importKeybindings({sourceLabel: 'import.json5', text: INVALID_TEXT});

    expect(outcome).toEqual(
      expected.kind === 'invalid' ? {diagnostics: expected.diagnostics, kind: 'invalid'} : {kind: 'written'}
    );
    expect(store.writeAttempts()).toBe(0);
  });

  test('reports a failed write and notifies', () => {
    const {calls, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.failNextWrite(new Error('disk full'));

    const outcome = service.importKeybindings({sourceLabel: 'import.json5', text: VALID_TEXT});

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

describe('active', () => {
  test('returns a copy that cannot rewrite the accepted keymaps', () => {
    // The verified policy keeps the payload opaque, so the service, not the
    // proof, must stop a caller from editing accepted state in place.
    const keymaps = {'window:new': ['ctrl+n', 'ctrl+shift+n']};
    const {service} = setup(serializeKeybindings(keymaps));
    service.start({kind: 'parsed-empty'});

    const returned = service.active();
    const shortcuts = returned['window:new'];
    if (Array.isArray(shortcuts)) {
      shortcuts.push('ctrl+alt+shift+n');
    }
    // SAFETY: `active()` returns the map it accepted, so assigning an extra
    // command here is exactly the in-place rewrite this test proves cannot
    // reach the accepted state.
    (returned as Record<string, string | string[]>)['window:close'] = 'ctrl+w';

    expect(service.active()).toEqual(keymaps);
  });
});

describe('load outcomes', () => {
  test('returns a copy that cannot rewrite the accepted keymaps', () => {
    // `start` and `reload` hand back a load outcome too, so a shared map there
    // would bypass the copy guarding `active()`.
    const keymaps = {'window:new': ['ctrl+n', 'ctrl+shift+n']};
    const {service} = setup(serializeKeybindings(keymaps));

    const outcome = service.start({kind: 'parsed-empty'});
    if (outcome.kind !== 'applied') {
      throw new Error(`expected an applied outcome, got ${outcome.kind}`);
    }

    const shortcuts = outcome.keymaps['window:new'];
    if (Array.isArray(shortcuts)) {
      shortcuts.push('ctrl+alt+shift+n');
    }
    // SAFETY: the outcome carries the map the service accepted, so assigning an
    // extra command here is the in-place rewrite this test proves is blocked.
    (outcome.keymaps as Record<string, string | string[]>)['window:close'] = 'ctrl+w';

    expect(service.active()).toEqual(keymaps);
  });
});

describe('stale temporary files', () => {
  test('cleans once at start-up and never on a reload or import', () => {
    const store = createMemoryKeybindingsStore();
    const {notify} = createNotifier();
    let cleanups = 0;
    const service = createKeybindingsService({
      notify,
      store: {
        ...store,
        removeStaleTemporaryFiles: () => {
          cleanups += 1;
        }
      }
    });

    service.start({kind: 'parsed-empty'});
    service.reload();
    // A second `start` is a reload, so it must not clean again.
    service.start({kind: 'parsed-empty'});
    service.importKeybindings({sourceLabel: 'memory-keybindings.json5', text: serializeKeybindings(KEYMAPS_A)});

    expect(cleanups).toBe(1);
  });

  test('removes a crash leftover through the real store at start-up', () => {
    // The store test proves the matching rule; this one proves the composition
    // actually reaches it, which a stub-only test cannot show.
    const workspace = fs.mkdtempSync(path.join(tmpdir(), 'velocetty-keybindings-service-'));
    try {
      const filePath = path.join(workspace, 'keybindings.json5');
      const stalePath = path.join(workspace, '.keybindings.json5.4242.1.tmp');
      const stored = serializeKeybindings(KEYMAPS_A);
      fs.writeFileSync(filePath, stored, 'utf8');
      fs.writeFileSync(stalePath, 'partial write', 'utf8');
      const service = createKeybindingsService({
        notify: createNotifier().notify,
        store: createFileKeybindingsStore({filePath})
      });

      const outcome = service.start({kind: 'parsed-empty'});

      expect(outcome.kind).toBe('applied');
      expect(fs.existsSync(stalePath)).toBe(false);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(stored);
    } finally {
      fs.rmSync(workspace, {force: true, recursive: true});
    }
  });
});
