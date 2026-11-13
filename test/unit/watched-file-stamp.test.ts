/**
 * @file Pins how a watched file's identity is read and compared at readiness.
 *
 * The failure this guards is subtle: when a failed inspection was recorded as
 * "absent", two failures compared equal and readiness skipped its one
 * reconciliation reload. The tests use an injected inspection call so each
 * failure mode's identity can be stated without touching the filesystem.
 */
import {describe, expect, test} from 'bun:test';

import {
  captureWatchedFileStamps,
  createWatchedFileReconciler,
  readWatchedFileStamp,
  settleWatchedFileStamps,
  stampsMatch,
  type ReadWatchedFile,
  type StatFile
} from '../../app/config/watched-file-stamp';

/** A stat result with a distinct size and modification time. */
const reading = (mtimeMs: number, size: number) => ({mtimeMs, size});

/** A stat call that throws a Node-style error carrying `code`. */
const throwingStat =
  (code: string): StatFile =>
  () => {
    throw Object.assign(new Error(`failed with ${code}`), {code});
  };

/** A stat call that throws a value which is not an error at all. */
const throwingNonErrorStat: StatFile = () => {
  throw 'permission denied';
};

/** A text reader that always returns the text it was built with. */
const readText =
  (text: string): ReadWatchedFile =>
  () =>
    text;

/** A text reader that fails the way an unreadable file does. */
const unreadableRead: ReadWatchedFile = () => {
  throw Object.assign(new Error('denied'), {code: 'EACCES'});
};

/** A single-path reconciler whose inspection results are scripted in order. */
const scripted = (readings: StatFile[]) => {
  const remaining = [...readings];
  const stat: StatFile = (filePath) => {
    const next = remaining.shift();
    if (next === undefined) {
      throw new Error('The reconciler inspected the file more often than the test scripted.');
    }
    return next(filePath);
  };
  const baseline = captureWatchedFileStamps(['/tmp/config.json5'], stat);
  return createWatchedFileReconciler(baseline, stat);
};

describe('readWatchedFileStamp', () => {
  test('records a file that could be inspected', () => {
    expect(readWatchedFileStamp('/tmp/config.json5', () => reading(12, 34))).toEqual({
      kind: 'present',
      mtimeMs: 12,
      size: 34
    });
  });

  test('records a missing file as absent', () => {
    expect(readWatchedFileStamp('/tmp/config.json5', throwingStat('ENOENT'))).toEqual({kind: 'absent'});
  });

  test('records any other failure as an unknown identity', () => {
    expect(readWatchedFileStamp('/tmp/config.json5', throwingStat('EACCES'))).toEqual({kind: 'unreadable'});
    expect(readWatchedFileStamp('/tmp/config.json5', throwingStat('EIO'))).toEqual({kind: 'unreadable'});
  });

  test('records a thrown non-error as an unknown identity', () => {
    expect(readWatchedFileStamp('/tmp/config.json5', throwingNonErrorStat)).toEqual({kind: 'unreadable'});
  });
});

describe('stampsMatch', () => {
  test('matches two readings of the same file state', () => {
    expect(stampsMatch({kind: 'present', mtimeMs: 12, size: 34}, {kind: 'present', mtimeMs: 12, size: 34})).toBe(true);
    expect(stampsMatch({kind: 'absent'}, {kind: 'absent'})).toBe(true);
  });

  test('rejects a changed modification time or size', () => {
    expect(stampsMatch({kind: 'present', mtimeMs: 12, size: 34}, {kind: 'present', mtimeMs: 13, size: 34})).toBe(false);
    expect(stampsMatch({kind: 'present', mtimeMs: 12, size: 34}, {kind: 'present', mtimeMs: 12, size: 35})).toBe(false);
  });

  test('never matches an unknown identity, even another unknown one', () => {
    expect(stampsMatch({kind: 'unreadable'}, {kind: 'unreadable'})).toBe(false);
    expect(stampsMatch({kind: 'unreadable'}, {kind: 'absent'})).toBe(false);
    expect(stampsMatch({kind: 'absent'}, {kind: 'unreadable'})).toBe(false);
    expect(stampsMatch({kind: 'present', mtimeMs: 12, size: 34}, {kind: 'unreadable'})).toBe(false);
  });
});

describe('captureWatchedFileStamps', () => {
  test('reads every named file once and keys it by path', () => {
    const seen: string[] = [];
    const stat: StatFile = (filePath) => {
      seen.push(filePath);
      return reading(1, 2);
    };

    const stamps = captureWatchedFileStamps(['/tmp/a.json5', '/tmp/b.json5'], stat);

    expect(seen).toEqual(['/tmp/a.json5', '/tmp/b.json5']);
    expect([...stamps.keys()]).toEqual(['/tmp/a.json5', '/tmp/b.json5']);
    expect(stamps.get('/tmp/a.json5')).toEqual({kind: 'present', mtimeMs: 1, size: 2});
  });
});

describe('settleWatchedFileStamps', () => {
  /** A baseline in which the seeded file is absent and the user's config exists. */
  const beforeImport = new Map([
    ['/tmp/config.json5', {kind: 'present' as const, mtimeMs: 1, size: 1}],
    ['/tmp/keybindings.json5', {kind: 'absent' as const}]
  ]);

  test('adopts a written file that still holds the applied text', () => {
    const seen: string[] = [];
    const stat: StatFile = (filePath) => {
      seen.push(filePath);
      return reading(2, 3);
    };

    const settled = settleWatchedFileStamps(
      beforeImport,
      [{path: '/tmp/keybindings.json5', text: '{}\n'}],
      readText('{}\n'),
      stat
    );

    // The file the import did not write keeps the identity it had before the
    // import, so a concurrent edit to it still reconciles.
    expect(seen).toEqual(['/tmp/keybindings.json5']);
    expect(settled.get('/tmp/config.json5')).toEqual({kind: 'present', mtimeMs: 1, size: 1});
    expect(settled.get('/tmp/keybindings.json5')).toEqual({kind: 'present', mtimeMs: 2, size: 3});
  });

  test('keeps the pre-import identity when the file no longer holds the applied text', () => {
    const stat: StatFile = () => reading(2, 3);

    const settled = settleWatchedFileStamps(
      beforeImport,
      [{path: '/tmp/keybindings.json5', text: '{}\n'}],
      readText('{"window:new": ["ctrl+n"]}\n'),
      stat
    );

    // The identity on disk describes content the import never applied. Keeping
    // the older identity is what makes readiness reload rather than compare the
    // file against itself.
    expect(settled.get('/tmp/keybindings.json5')).toEqual({kind: 'absent'});
    expect(createWatchedFileReconciler(settled, stat)()).toBe(true);
  });

  test('keeps the pre-import identity when the file cannot be read', () => {
    const settled = settleWatchedFileStamps(
      beforeImport,
      [{path: '/tmp/keybindings.json5', text: '{}\n'}],
      unreadableRead,
      () => reading(2, 3)
    );

    expect(settled.get('/tmp/keybindings.json5')).toEqual({kind: 'absent'});
  });

  test('keeps the pre-import identity when the file is gone', () => {
    const seenReads: string[] = [];
    const readFile: ReadWatchedFile = (filePath) => {
      seenReads.push(filePath);
      return '{}\n';
    };

    const settled = settleWatchedFileStamps(
      beforeImport,
      [{path: '/tmp/keybindings.json5', text: '{}\n'}],
      readFile,
      throwingStat('ENOENT')
    );

    // Nothing to compare with, so the read is skipped and the earlier identity
    // stands; readiness sees the file as present and reloads.
    expect(seenReads).toEqual([]);
    expect(settled.get('/tmp/keybindings.json5')).toEqual({kind: 'absent'});
  });

  test('a file start-up seeded is not reconciled against the pre-import baseline', () => {
    // The baseline is captured first, so the seeded file reads as absent there;
    // settling it after the import is what keeps first run quiet.
    const scriptedReadings = [throwingStat('ENOENT'), () => reading(2, 3), () => reading(2, 3)];
    const script: StatFile = (filePath) => {
      const next = scriptedReadings.shift();
      if (next === undefined) {
        throw new Error('The test scripted fewer inspections than the code performed.');
      }
      return next(filePath);
    };

    const baseline = captureWatchedFileStamps(['/tmp/keybindings.json5'], script);
    const settled = settleWatchedFileStamps(
      baseline,
      [{path: '/tmp/keybindings.json5', text: '{}\n'}],
      readText('{}\n'),
      script
    );

    expect(createWatchedFileReconciler(settled, script)()).toBe(false);
  });
});

describe('createWatchedFileReconciler', () => {
  test('reports no change when the file is untouched', () => {
    const reconcile = scripted([() => reading(12, 34), () => reading(12, 34)]);

    expect(reconcile()).toBe(false);
  });

  test('reports a change when the file moved during the scan', () => {
    const reconcile = scripted([() => reading(12, 34), () => reading(13, 34)]);

    expect(reconcile()).toBe(true);
  });

  test('reports a change when the file appeared during the scan', () => {
    const reconcile = scripted([throwingStat('ENOENT'), () => reading(12, 34)]);

    expect(reconcile()).toBe(true);
  });

  test('reports a change when the first inspection failed', () => {
    const reconcile = scripted([throwingStat('EACCES'), () => reading(12, 34)]);

    expect(reconcile()).toBe(true);
  });

  test('reports a change when both inspections failed', () => {
    const denied = throwingStat('EACCES');
    const reconcile = scripted([denied, denied]);

    // Two unknown readings are not evidence that nothing changed, so the
    // readiness pass reloads rather than trusting their apparent equality.
    expect(reconcile()).toBe(true);
  });

  test('reports no change when the file is absent at both readings', () => {
    const absent = throwingStat('ENOENT');
    const reconcile = scripted([absent, absent]);

    expect(reconcile()).toBe(false);
  });
});
