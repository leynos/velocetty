/** @file KB-PATH-3: both probe copies classify presence, links, and faults identically. */
import {describe, expect, test} from 'bun:test';

import {
  createPathProbe as createAppPathProbe,
  type PathProbeFileSystem,
  type ProbeState,
  resolveConfigLocations
} from '../../app/config/config-tree';
import {createPathProbe as createSharedPathProbe} from '../../shared/src/config/config-tree';

/** What one `stat` or `lstat` call does in a case. */
type CallOutcome =
  | 'entry'
  | 'missing'
  | 'not-a-directory'
  | 'denied'
  | 'not-permitted'
  | 'io-error'
  | 'symlink-loop'
  | 'unknown-code'
  | 'codeless-error';

/** Builds a Node-style errno error, the shape the probe classifies. */
const coded = (code: string) => Object.assign(new Error(`${code}: simulated`), {code});

/** The outcome of a call that answers with an entry, and has no error to build. */
type AnsweringOutcome = 'entry';

/** The outcome of a call that fails with an error carrying no code. */
type UncodedOutcome = 'codeless-error';

/**
 * The errno code each coded failure carries.
 *
 * `ESTALE` stands in for any code this module has never seen: it proves nothing
 * about the file, exactly as an unknown code from a future platform would not.
 * The `Record` keys make the table exhaustive by construction.
 */
const failureCodes: Readonly<Record<Exclude<CallOutcome, AnsweringOutcome | UncodedOutcome>, string>> = {
  missing: 'ENOENT',
  'not-a-directory': 'ENOTDIR',
  denied: 'EACCES',
  'not-permitted': 'EPERM',
  'io-error': 'EIO',
  'symlink-loop': 'ELOOP',
  'unknown-code': 'ESTALE'
};

/** Builds the error a call throws, or nothing when it answers with an entry. */
const errorFor = (outcome: CallOutcome): Error | undefined => {
  if (outcome === 'entry') {
    return undefined;
  }
  if (outcome === 'codeless-error') {
    // A double, or a foreign error, that carries no code: it proves nothing
    // about the file.
    return new Error('simulated failure');
  }
  return coded(failureCodes[outcome]);
};

/** A filesystem slice whose two calls answer from the supplied outcomes. */
const fakeFileSystem = (stat: CallOutcome, lstat: CallOutcome): PathProbeFileSystem => {
  /** Answers one call with the outcome's value, or throws its error. */
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
  // Only a missing entry, or a parent that is not a directory, is absence.
  {expected: 'absent', lstat: 'missing', stat: 'missing'},
  {expected: 'absent', lstat: 'not-a-directory', stat: 'not-a-directory'},
  {expected: 'absent', lstat: 'not-a-directory', stat: 'missing'},
  // Every other fault means the file may exist, so absence is never claimed.
  {expected: 'inaccessible', lstat: 'entry', stat: 'denied'},
  {expected: 'inaccessible', lstat: 'entry', stat: 'not-permitted'},
  {expected: 'inaccessible', lstat: 'entry', stat: 'io-error'},
  {expected: 'inaccessible', lstat: 'entry', stat: 'symlink-loop'},
  {expected: 'inaccessible', lstat: 'denied', stat: 'missing'},
  // A secondary check that fails establishes nothing either.
  {expected: 'inaccessible', lstat: 'symlink-loop', stat: 'missing'},
  {expected: 'inaccessible', lstat: 'unknown-code', stat: 'missing'},
  // Errors carrying no code are unclassifiable, so they cannot be absence.
  {expected: 'inaccessible', lstat: 'entry', stat: 'codeless-error'},
  {expected: 'inaccessible', lstat: 'codeless-error', stat: 'codeless-error'}
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

  test('carries an unclassifiable failure into the resolver as inaccessible', () => {
    // The probe is the resolver's only view of the disk, so an error it cannot
    // classify has to reach the start-up decision as "presence unknown", not as
    // permission for start-up to create a file over whatever may be there.
    const activePath = '/home/ada/.config/Velocetty/config.json5';
    const missing = () => {
      throw coded('ENOENT');
    };
    const probe = createAppPathProbe({
      lstatSync: missing,
      statSync: (candidate) => {
        if (candidate === activePath) {
          throw new Error('simulated failure');
        }
        throw coded('ENOENT');
      }
    });

    const locations = resolveConfigLocations({
      appDataDirectory: '/home/ada/.config',
      development: {directory: '/repo', enabled: false},
      homeDirectory: '/home/ada',
      hyperUserDataDirectory: '/home/ada/.config/Hyper',
      platform: 'linux',
      probe,
      sameFile: (left, right) => left === right,
      xdgConfigHome: undefined
    });

    expect(locations.config).toEqual({
      exists: false,
      inspection: 'inaccessible',
      path: activePath,
      tree: 'velocetty'
    });
  });
});
