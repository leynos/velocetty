/** @file Named examples for the keybindings service: start, reload, import, export. */
import {describe, expect, test} from 'bun:test';

import {createKeybindingsService} from '../../app/config/keybindings';
import {keybindingsCodec, parseKeybindingsText, serializeKeybindings} from '../../app/config/keybindings-codec';
import type {KeybindingsNotice} from '../../app/config/keybindings-ports';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import {createMemoryKeybindingsStore} from '../testUtils/memory-keybindings-store';

const KEYMAPS_A: UserKeymaps = {'window:new': 'ctrl+n'};
const KEYMAPS_B: UserKeymaps = {'window:close': 'ctrl+w'};
const VALID_TEXT = serializeKeybindings(KEYMAPS_B);
const INVALID_TEXT = '{broken';
const OTHER_INVALID_TEXT = '[1, 2]';

/** Records the bounded notices the service reports, with no presentation. */
const createReporter = () => {
  const notices: KeybindingsNotice[] = [];
  return {
    notices,
    report: (notice: KeybindingsNotice) => {
      notices.push(notice);
    }
  };
};

const lastNotice = (notices: readonly KeybindingsNotice[]): KeybindingsNotice | undefined => notices.at(-1);

const invalidFileNotices = (notices: readonly KeybindingsNotice[]) =>
  notices.filter((notice) => notice.kind === 'invalid-file');

const setup = (initialText?: string) => {
  const store = createMemoryKeybindingsStore();
  if (initialText !== undefined) {
    store.setText(initialText);
  }
  const reporter = createReporter();
  const service = createKeybindingsService({codec: keybindingsCodec, report: reporter.report, store});
  return {...reporter, service, store};
};

describe('start', () => {
  test('seeds a missing file from parsed legacy keymaps', () => {
    const {notices, service, store} = setup();

    const outcome = service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    expect(outcome).toEqual({keymaps: KEYMAPS_A, kind: 'applied', origin: 'seeded'});
    expect(store.writtenTexts()).toEqual([serializeKeybindings(KEYMAPS_A)]);
    expect(notices).toEqual([]);
  });

  test('seeds an empty file when the legacy source carries no keymaps', () => {
    const {service, store} = setup();

    const outcome = service.start({kind: 'parsed-empty'});

    expect(outcome).toEqual({keymaps: {}, kind: 'applied', origin: 'seeded'});
    expect(store.writtenTexts()).toEqual([serializeKeybindings({})]);
  });

  test('reports an unsaved seed when the write fails', () => {
    const {notices, service, store} = setup();
    store.failNextWrite('permission');

    const outcome = service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    // The shortcut set still takes effect for this session, but nothing reached
    // the disk, so the origin distinguishes it from a completed migration.
    expect(outcome).toEqual({keymaps: KEYMAPS_A, kind: 'applied', origin: 'seeded-unsaved'});
    expect(store.writtenTexts()).toEqual([]);
    expect(lastNotice(notices)).toEqual({failure: 'permission', kind: 'seed-failed'});
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
    const {notices, service, store} = setup();
    store.setUnreadable('permission');

    const outcome = service.start({kind: 'parsed-empty'});

    expect(outcome).toMatchObject({basis: 'empty', cause: 'unreadable', keymaps: {}, kind: 'kept'});
    expect(store.writeAttempts()).toBe(0);
    // The service names the bounded reason; the edge composes the sentence.
    expect(notices).toEqual([{basis: 'empty', failure: 'permission', kind: 'unreadable-file'}]);
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
    const {notices, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setText(INVALID_TEXT);

    const outcome = service.reload();

    expect(outcome).toMatchObject({
      basis: 'last-known-good',
      cause: 'invalid',
      keymaps: KEYMAPS_A,
      kind: 'kept'
    });
    expect(lastNotice(notices)).toMatchObject({basis: 'last-known-good', kind: 'invalid-file'});
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

  test('keeps an unsaved seed in effect while the file is still missing', () => {
    const {service, store} = setup();
    store.failNextWrite('permission');
    service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    const outcome = service.reload();

    // The seed never reached the disk, so the still-missing file is not a
    // deliberate reset and must not drop the shortcuts it put in effect.
    expect(outcome).toEqual({keymaps: KEYMAPS_A, kind: 'applied', origin: 'seeded-unsaved'});
    expect(service.active()).toEqual(KEYMAPS_A);
    expect(store.writeAttempts()).toBe(1);
  });

  test('keeps an unsaved seed through an unreadable reload while the file is missing', () => {
    const {service, store} = setup();
    store.failNextWrite('permission');
    service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});

    // A permission failure on a parent directory hides whether the seed ever
    // reached the disk, so it cannot supersede the unsaved marker.
    store.setUnreadable('permission');
    expect(service.reload()).toMatchObject({basis: 'last-known-good', cause: 'unreadable', kind: 'kept'});

    // Permissions recover and the file is still absent: the seed is still unsaved.
    store.setMissing();
    expect(service.reload()).toEqual({keymaps: KEYMAPS_A, kind: 'applied', origin: 'seeded-unsaved'});
    expect(service.active()).toEqual(KEYMAPS_A);
  });

  test('clears the unsaved-seed marker once the file can be read', () => {
    const {service, store} = setup();
    store.failNextWrite('permission');
    service.start({keymaps: KEYMAPS_A, kind: 'parsed-keymaps'});
    store.setText(serializeKeybindings(KEYMAPS_B));

    expect(service.reload()).toEqual({keymaps: KEYMAPS_B, kind: 'applied', origin: 'file'});

    // The file exists again, so deleting it is a deliberate reset once more.
    store.setMissing();
    expect(service.reload()).toEqual({keymaps: {}, kind: 'applied', origin: 'missing'});
  });

  test('treats a missing file as an accepted empty map', () => {
    const {notices, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setMissing();
    service.reload();
    store.setText(INVALID_TEXT);

    const outcome = service.reload();

    // `missing` is an accepted observation in the policy, so the rejected read
    // that follows is backed by a last-known-good payload (the empty map).
    expect(outcome).toMatchObject({basis: 'last-known-good', cause: 'invalid', kind: 'kept'});
    expect(lastNotice(notices)).toMatchObject({basis: 'last-known-good', kind: 'invalid-file'});
  });

  test('shows an unchanged diagnostic only once', () => {
    const {notices, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setText(INVALID_TEXT);

    service.reload();
    service.reload();

    expect(invalidFileNotices(notices)).toHaveLength(1);
  });

  test('shows a changed diagnostic again', () => {
    const {notices, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.setText(INVALID_TEXT);
    service.reload();
    store.setText(OTHER_INVALID_TEXT);

    service.reload();

    expect(invalidFileNotices(notices)).toHaveLength(2);
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
    const {notices, service, store} = setup(serializeKeybindings(KEYMAPS_A));
    service.start({kind: 'parsed-empty'});
    store.failNextWrite('other');

    const outcome = service.importKeybindings({sourceLabel: 'import.json5', text: VALID_TEXT});

    expect(outcome).toEqual({failure: 'other', kind: 'failed'});
    expect(store.writeAttempts()).toBe(1);
    expect(store.writtenTexts()).toEqual([]);
    expect(lastNotice(notices)).toEqual({failure: 'other', kind: 'import-failed'});
  });
});

describe('exportKeybindings', () => {
  test('returns the stored text verbatim', () => {
    const {notices, service, store} = setup(VALID_TEXT);
    service.start({kind: 'parsed-empty'});

    expect(service.exportKeybindings()).toEqual({kind: 'stored', text: VALID_TEXT});
    expect(store.writeAttempts()).toBe(0);
    expect(notices).toEqual([]);
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
    store.setUnreadable('permission');

    expect(service.exportKeybindings()).toEqual({failure: 'permission', kind: 'unreadable'});
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

describe('startup cleanup ownership', () => {
  test('never removes stale temporary files itself', () => {
    let cleanups = 0;
    // The adapter owns cleanup beside the port, so the test double carries it
    // too; the service must still never reach for it.
    const store = {
      ...createMemoryKeybindingsStore(),
      removeStaleTemporaryFiles: () => {
        cleanups += 1;
      }
    };
    const service = createKeybindingsService({
      codec: keybindingsCodec,
      report: createReporter().report,
      store
    });

    service.start({kind: 'parsed-empty'});
    service.reload();
    // A second `start` is a reload too.
    service.start({kind: 'parsed-empty'});
    service.importKeybindings({sourceLabel: 'memory-keybindings.json5', text: serializeKeybindings(KEYMAPS_A)});

    // Cleanup belongs to the composition root, which calls it before `start`.
    expect(cleanups).toBe(0);
  });
});

describe('bounded notices', () => {
  test('reports only the notice vocabulary, never presentation text', () => {
    const store = createMemoryKeybindingsStore();
    store.setText(INVALID_TEXT);
    const notices: KeybindingsNotice[] = [];
    const service = createKeybindingsService({
      codec: keybindingsCodec,
      report: (notice) => notices.push(notice),
      store
    });

    service.start({kind: 'parsed-empty'});

    // The reporter sees only structured notices: no titles, bodies, or paths.
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({kind: 'diagnostics', label: 'memory-keybindings.json5'});
    expect(notices[1]).toMatchObject({basis: 'empty', kind: 'invalid-file'});
    expect(notices.map((notice) => Object.hasOwn(notice, 'title'))).toEqual([false, false]);
  });
});
