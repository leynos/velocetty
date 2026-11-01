/** @file KB-STORE-1: atomic, non-destructive writes through the file adapter. */
import {afterEach, describe, expect, mock, test} from 'bun:test';

import * as fs from 'node:fs';
import path from 'node:path';

import type {ConfigSpanRecorder} from '../../app/config/config-spans';
import type {KeybindingsReadOutcome, KeybindingsWriteOutcome} from '../../app/config/keybindings-ports';
import type {KeybindingsFileSystem} from '../../app/config/keybindings-store';
import {createFileKeybindingsStore} from '../../app/config/keybindings-store';
import {
  cleanupWorkspaces,
  createWorkspace,
  danglingLinkStoreWith,
  errorWithCode,
  expectRefusedWrite,
  realFileSystem,
  TEMPORARY_PREFIX,
  targetPathIn,
  temporaryNames
} from '../testUtils/keybindings-store-harness';

afterEach(cleanupWorkspaces);

/** The adapter under test, so table-driven cases can name its methods. */
type Store = ReturnType<typeof createFileKeybindingsStore>;

/** Records the operation and outcome of every completed span, in order. */
const recordingSpans = () => {
  const finished: string[] = [];
  const spans: ConfigSpanRecorder = {
    begin: (operation) => (outcome) => {
      finished.push(`${operation}:${outcome}`);
    }
  };
  return {finished, spans};
};

describe('atomic keybindings file store', () => {
  test('reads a present file, a missing file, and an unreadable file', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const store = createFileKeybindingsStore({filePath});

    expect(store.read()).toEqual({kind: 'missing'});

    fs.writeFileSync(filePath, `{'window:new': 'ctrl+n'}`, 'utf8');
    expect(store.read()).toEqual({kind: 'present', text: `{'window:new': 'ctrl+n'}`});

    const unreadable = createFileKeybindingsStore({
      filePath,
      fs: {
        ...realFileSystem(),
        readFileSync: () => {
          throw errorWithCode('EACCES');
        }
      }
    });
    expect(unreadable.read().kind).toBe('unreadable');
  });

  /**
   * Each permission test fails one filesystem call and states what the port
   * should see, so the read and write paths are proved by the same assertions.
   */
  const permissionCases: readonly Readonly<{
    call: (store: Store) => KeybindingsReadOutcome | KeybindingsWriteOutcome;
    description: string;
    message: string;
    outcome: KeybindingsReadOutcome | KeybindingsWriteOutcome;
    overrides: (raw: unknown) => Partial<KeybindingsFileSystem>;
  }>[] = [
    {
      call: (store) => store.read(),
      description: 'read',
      message: "Couldn't read",
      outcome: {failure: 'permission', kind: 'unreadable'},
      overrides: (raw) => ({
        readFileSync: () => {
          throw raw;
        }
      })
    },
    {
      call: (store) => store.write('replacement'),
      description: 'write',
      message: "Couldn't write",
      outcome: {failure: 'permission', kind: 'failed'},
      overrides: (raw) => ({
        openSync: () => {
          throw raw;
        }
      })
    }
  ];

  for (const {call, description, message, outcome, overrides} of permissionCases) {
    test(`classifies a permission ${description} failure and still logs the raw error`, () => {
      const raw = errorWithCode('EACCES');
      const warn = mock(() => {});
      const store = createFileKeybindingsStore({
        filePath: targetPathIn(createWorkspace()),
        fs: {...realFileSystem(), ...overrides(raw)},
        warn
      });

      // The port sees only the bounded reason; the adapter keeps the raw error
      // diagnosable through its own warning sink.
      expect(call(store)).toEqual(outcome);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(message), raw);
    });
  }

  test('maps a missing target to its bounded failure category', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const store = createFileKeybindingsStore({
      filePath,
      fs: {
        ...realFileSystem(),
        renameSync: () => {
          throw errorWithCode('ENOENT');
        }
      },
      warn: mock(() => {})
    });

    expect(store.write('replacement')).toEqual({failure: 'missing', kind: 'failed'});
  });

  test('writes the replacement bytes and preserves the target mode', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, '{}', 'utf8');
    fs.chmodSync(filePath, 0o640);
    const store = createFileKeybindingsStore({filePath});

    expect(store.write(`{'window:new': 'ctrl+n'}`)).toEqual({kind: 'written'});

    expect(fs.readFileSync(filePath, 'utf8')).toBe(`{'window:new': 'ctrl+n'}`);
    if (process.platform !== 'win32') {
      // Windows models only the read-only bit, so the POSIX mode round trip
      // is asserted where it is meaningful.
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o640);
    }
    expect(temporaryNames(workspace)).toEqual([]);
  });

  test('creates a missing file', () => {
    const workspace = createWorkspace();
    const store = createFileKeybindingsStore({filePath: targetPathIn(workspace)});

    expect(store.write('{}')).toEqual({kind: 'written'});
    expect(fs.readFileSync(targetPathIn(workspace), 'utf8')).toBe('{}');
  });

  /**
   * A link is written through, whether its target exists or not. Only the read
   * before the write differs, so the shared assertions are stated once.
   */
  const symlinkCases: readonly Readonly<{
    description: string;
    expectedRead: KeybindingsReadOutcome;
    seedTarget: boolean;
  }>[] = [
    {
      description: 'keeps a symlink and replaces the file it points at',
      expectedRead: {kind: 'present', text: '{}'},
      seedTarget: true
    },
    {
      description: 'creates the target of a dangling symlink instead of replacing the link',
      expectedRead: {kind: 'missing'},
      seedTarget: false
    }
  ];

  for (const {description, expectedRead, seedTarget} of symlinkCases) {
    test(description, () => {
      const workspace = createWorkspace();
      const realPath = path.join(workspace, 'dotfiles-keybindings.json5');
      const linkPath = targetPathIn(workspace);
      if (seedTarget) {
        fs.writeFileSync(realPath, '{}', 'utf8');
      }
      fs.symlinkSync(path.basename(realPath), linkPath);
      const store = createFileKeybindingsStore({filePath: linkPath});

      expect(store.read()).toEqual(expectedRead);
      expect(store.write(`{'window:new': 'ctrl+n'}`)).toEqual({kind: 'written'});

      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(linkPath)).toBe(path.basename(realPath));
      expect(fs.readFileSync(realPath, 'utf8')).toBe(`{'window:new': 'ctrl+n'}`);
      expect(temporaryNames(workspace)).toEqual([]);
    });
  }

  test('follows a dangling link through an intermediate link to the missing target', () => {
    const workspace = createWorkspace();
    const realPath = path.join(workspace, 'nested', 'dotfiles-keybindings.json5');
    const intermediatePath = path.join(workspace, 'intermediate.json5');
    const linkPath = targetPathIn(workspace);
    fs.mkdirSync(path.dirname(realPath));
    fs.symlinkSync(path.join('nested', 'dotfiles-keybindings.json5'), intermediatePath);
    fs.symlinkSync(path.basename(intermediatePath), linkPath);
    const store = createFileKeybindingsStore({filePath: linkPath});

    expect(store.write('{}')).toEqual({kind: 'written'});

    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(intermediatePath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(realPath, 'utf8')).toBe('{}');
  });

  test('refuses a dangling chain longer than the hop limit without replacing a link', () => {
    const workspace = createWorkspace();
    // One link more than the adapter's 40-hop bound, ending at a missing file.
    const linkPaths = [
      targetPathIn(workspace),
      ...Array.from({length: 40}, (_, index) => path.join(workspace, `hop-${index + 1}.json5`))
    ];
    for (const [index, linkPath] of linkPaths.entries()) {
      const next = linkPaths[index + 1] ?? path.join(workspace, 'missing-target.json5');
      fs.symlinkSync(path.relative(workspace, next), linkPath);
    }
    const store = createFileKeybindingsStore({filePath: linkPaths[0]});

    expectRefusedWrite({linkPaths, store, workspace});

    expect(fs.existsSync(path.join(workspace, 'missing-target.json5'))).toBe(false);
  });

  test('refuses a symlink cycle without replacing a link', () => {
    const workspace = createWorkspace();
    const linkPath = targetPathIn(workspace);
    const otherPath = path.join(workspace, 'other.json5');
    fs.symlinkSync(path.basename(otherPath), linkPath);
    fs.symlinkSync(path.basename(linkPath), otherPath);
    const store = createFileKeybindingsStore({filePath: linkPath});

    expectRefusedWrite({linkPaths: [linkPath, otherPath], store, workspace});
  });

  const unresolvableCases: readonly Readonly<{
    description: string;
    overrides: Partial<KeybindingsFileSystem>;
  }>[] = [
    {
      description: 'the link target cannot be read',
      overrides: {
        readlinkSync: () => {
          throw errorWithCode('EACCES');
        }
      }
    },
    {
      description: 'the path cannot be inspected',
      overrides: {
        lstatSync: () => {
          throw errorWithCode('EACCES');
        }
      }
    }
  ];

  for (const {description, overrides} of unresolvableCases) {
    test(`fails closed when ${description}`, () => {
      const {linkPath, realPath, store, workspace} = danglingLinkStoreWith(overrides);

      expectRefusedWrite({linkPaths: [linkPath], store, workspace});

      expect(fs.existsSync(realPath)).toBe(false);
    });
  }

  test('removes only its own stale temporary files', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const ownStale = path.join(workspace, `${TEMPORARY_PREFIX}4242.0.tmp`);
    const ownOther = path.join(workspace, `${TEMPORARY_PREFIX}4242.1.tmp`);
    const foreign = path.join(workspace, '.other.json5.1.2.tmp');
    fs.writeFileSync(ownStale, 'stale', 'utf8');
    fs.writeFileSync(ownOther, 'stale', 'utf8');
    fs.writeFileSync(foreign, 'foreign', 'utf8');
    const store = createFileKeybindingsStore({filePath});

    store.removeStaleTemporaryFiles();

    expect(fs.existsSync(ownStale)).toBe(false);
    expect(fs.existsSync(ownOther)).toBe(false);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  test('records one read span for a present, missing, and unreadable file', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const {finished, spans} = recordingSpans();
    const store = createFileKeybindingsStore({filePath, spans});

    store.read();
    fs.writeFileSync(filePath, '{}', 'utf8');
    store.read();
    const unreadable = createFileKeybindingsStore({
      filePath,
      fs: {
        ...realFileSystem(),
        readFileSync: () => {
          throw errorWithCode('EACCES');
        }
      },
      spans
    });
    unreadable.read();

    expect(finished).toEqual(['keybindings-read:missing', 'keybindings-read:present', 'keybindings-read:unreadable']);
  });

  test('records a write span for a success and each refusal path', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const {finished, spans} = recordingSpans();
    const store = createFileKeybindingsStore({filePath, spans});

    expect(store.write('{}')).toEqual({kind: 'written'});

    // The early read-only refusal never creates a temporary file, but it still
    // completes the span, so a refused write cannot go uncounted.
    const readOnly = createFileKeybindingsStore({
      filePath,
      fs: {
        ...realFileSystem(),
        accessSync: () => {
          throw errorWithCode('EACCES');
        }
      },
      spans,
      warn: mock(() => {})
    });
    expect(readOnly.write('replacement')).toEqual({failure: 'permission', kind: 'failed'});

    // A failure after the temporary file exists takes the same outcome.
    const failing = createFileKeybindingsStore({
      filePath,
      fs: {
        ...realFileSystem(),
        openSync: () => {
          throw errorWithCode('EACCES');
        }
      },
      spans,
      warn: mock(() => {})
    });
    expect(failing.write('replacement')).toEqual({failure: 'permission', kind: 'failed'});

    expect(finished).toEqual(['keybindings-write:written', 'keybindings-write:failed', 'keybindings-write:failed']);
  });
});
