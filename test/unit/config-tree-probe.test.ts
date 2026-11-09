/** @file KB-PATH-3: both probe copies classify presence, links, and faults identically. */
import {describe, expect, test} from 'bun:test';

import {
  createPathProbe as createAppPathProbe,
  type PathProbeFileSystem,
  type ProbeState
} from '../../app/config/config-tree';
import {createPathProbe as createSharedPathProbe} from '../../shared/src/config/config-tree';

/** What one `stat` or `lstat` call does in a case. */
type CallOutcome = 'entry' | 'missing' | 'denied' | 'not-permitted' | 'io-error' | 'codeless-error';

/** Builds a Node-style errno error, the shape the probe classifies. */
const coded = (code: string) => Object.assign(new Error(`${code}: simulated`), {code});

/** Builds the error a call throws, or nothing when it answers with an entry. */
const errorFor = (outcome: CallOutcome): Error | undefined => {
  switch (outcome) {
    case 'entry': {
      return undefined;
    }
    case 'missing': {
      return coded('ENOENT');
    }
    case 'denied': {
      return coded('EACCES');
    }
    case 'not-permitted': {
      return coded('EPERM');
    }
    case 'io-error': {
      return coded('EIO');
    }
    case 'codeless-error': {
      // A double, or a foreign error, that carries no code: it proves nothing
      // about the file, so it must not be read as a permission fault.
      return new Error('simulated failure');
    }
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled call outcome: ${String(unreachable)}`);
    }
  }
};

/** A filesystem slice whose two calls answer from the supplied outcomes. */
const fakeFileSystem = (stat: CallOutcome, lstat: CallOutcome): PathProbeFileSystem => {
  const answer = (outcome: CallOutcome) => {
    const error = errorFor(outcome);
    if (error !== undefined) {
      throw error;
    }
    return {};
  };
  return {lstatSync: () => answer(lstat), statSync: () => answer(stat)};
};

/** One probe scenario: how each call answers, and what the probe must report. */
type ProbeCase = Readonly<{
  readonly expected: ProbeState;
  readonly lstat: CallOutcome;
  readonly stat: CallOutcome;
}>;

const probeCases: readonly ProbeCase[] = [
  // `stat` alone proves presence; `lstat` is never consulted.
  {expected: 'present', lstat: 'denied', stat: 'entry'},
  // `lstat` succeeding after `stat` failed is a dangling symlink.
  {expected: 'broken-link', lstat: 'entry', stat: 'missing'},
  {expected: 'absent', lstat: 'missing', stat: 'missing'},
  // A fault means the file may exist, so it is never reported as absent.
  {expected: 'inaccessible', lstat: 'entry', stat: 'denied'},
  {expected: 'inaccessible', lstat: 'entry', stat: 'not-permitted'},
  {expected: 'inaccessible', lstat: 'entry', stat: 'io-error'},
  {expected: 'inaccessible', lstat: 'denied', stat: 'missing'},
  // An uncoded error establishes nothing, so it falls through to `lstat`.
  {expected: 'broken-link', lstat: 'entry', stat: 'codeless-error'},
  {expected: 'absent', lstat: 'codeless-error', stat: 'codeless-error'}
];

const candidates = ['/home/ada/.config/Velocetty/config.json5', '/home/ada/.config/Hyper/config.json5'] as const;

describe('KB-PATH-3 path probe classification', () => {
  test('reports the expected state for every filesystem outcome', () => {
    for (const probeCase of probeCases) {
      const {expected, lstat, stat} = probeCase;
      expect(createAppPathProbe(fakeFileSystem(stat, lstat))(candidates[0])).toBe(expected);
    }
  });

  test('classifies every outcome the same way as the shared copy', () => {
    for (const probeCase of probeCases) {
      const fileSystem = fakeFileSystem(probeCase.stat, probeCase.lstat);
      for (const candidate of candidates) {
        expect(createAppPathProbe(fileSystem)(candidate)).toBe(createSharedPathProbe(fileSystem)(candidate));
      }
    }
  });
});
