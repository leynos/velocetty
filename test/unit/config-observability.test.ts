/** @file The bounded decision record, retry record, and counters for an import. */
import {describe, expect, test} from 'bun:test';

import {mkdirpSync, rmSync, writeFileSync} from 'fs-extra';

import {createConfigMetrics, describeConfigCounters} from '../../app/config/config-metrics';
import {createImportRecorder, type ImportRecorder} from '../../app/config/config-observability';
import {shouldAnnounceReload, type ConfigImportReport} from '../../app/config/import-report';
import type {KeybindingsLoadOutcome} from '../../app/config/keybindings';
import {
  createConfigImportHarness,
  type ConfigImportHarness,
  sharedDefaultConfigFixture
} from '../testUtils/config-import-harness';

type Sink = Readonly<{warn: string[]; info: string[]}>;

/** A recorder over an in-memory sink, so the exact emitted text is visible. */
const harness = () => {
  const sink: Sink = {info: [], warn: []};
  const recorder = createImportRecorder({
    metrics: createConfigMetrics(),
    sink: {info: (line) => sink.info.push(line), warn: (line) => sink.warn.push(line)}
  });
  return {recorder, sink};
};

const applied = (origin: 'file' | 'missing' | 'seeded' | 'seeded-unsaved'): KeybindingsLoadOutcome => ({
  keymaps: {},
  kind: 'applied',
  origin
});

const kept = (
  basis: 'last-known-good' | 'empty',
  cause: 'invalid' | 'unreadable' | 'deferred'
): KeybindingsLoadOutcome => ({basis, cause, diagnostics: [], keymaps: {}, kind: 'kept'});

const APPLIED_REPORT: ConfigImportReport = {config: 'applied', keybindings: 'applied'};

/** Records one reload decision from the Velocetty tree, as the app does. */
const recordImport = (recorder: ImportRecorder, outcome: KeybindingsLoadOutcome, report: ConfigImportReport): void => {
  recorder.beginImport({phase: 'reload'});
  recorder.recordImport({announced: false, configSource: 'velocetty', outcome, phase: 'reload', report});
};
const KEPT_REPORT: ConfigImportReport = {config: 'applied', keybindings: 'kept'};

describe('the import decision record', () => {
  test('names the origin of an applied file and counts one attempt and apply', () => {
    const {recorder, sink} = harness();

    recorder.beginImport({phase: 'reload'});
    recorder.recordImport({
      announced: true,
      configSource: 'velocetty',
      outcome: applied('file'),
      phase: 'reload',
      report: APPLIED_REPORT
    });

    expect(sink.info).toEqual([
      '[config] import attempt phase=reload',
      '[config] import decision phase=reload config=applied configSource=velocetty keybindings=applied origin=file ' +
        'announced=true attempts:1,applies:1,parseFailures:0,readFailures:0,fallbacks:0,importFailures:0,retries:0'
    ]);
    expect(sink.warn).toEqual([]);
    expect(recorder.counters()).toEqual({
      applies: 1,
      attempts: 1,
      fallbacks: 0,
      importFailures: 0,
      parseFailures: 0,
      readFailures: 0,
      retries: 0
    });
  });

  test('separates an empty file from a first-run seed by origin alone', () => {
    const {recorder, sink} = harness();

    for (const origin of ['missing', 'seeded', 'seeded-unsaved'] as const) {
      recorder.beginImport({phase: 'startup'});
      recorder.recordImport({
        announced: false,
        configSource: 'velocetty',
        outcome: applied(origin),
        phase: 'startup',
        report: APPLIED_REPORT
      });
    }

    const decisionLines = sink.info.filter((line) => line.startsWith('[config] import decision'));
    expect(decisionLines.map((line) => line.split(' announced=')[0])).toEqual([
      '[config] import decision phase=startup config=applied configSource=velocetty keybindings=applied origin=missing',
      '[config] import decision phase=startup config=applied configSource=velocetty keybindings=applied origin=seeded',
      '[config] import decision phase=startup config=applied configSource=velocetty keybindings=applied origin=seeded-unsaved'
    ]);
    // A seed that could not be written still applied in memory.
    expect(recorder.counters().applies).toBe(3);
    expect(recorder.counters().attempts).toBe(3);
  });

  test('counts a parse failure as a kept outcome, not a fallback', () => {
    const {recorder, sink} = harness();

    recorder.beginImport({phase: 'reload'});
    recorder.recordImport({
      announced: false,
      configSource: 'velocetty',
      outcome: kept('last-known-good', 'invalid'),
      phase: 'reload',
      report: KEPT_REPORT
    });

    expect(sink.info[1]).toBe(
      '[config] import decision phase=reload config=applied configSource=velocetty keybindings=kept ' +
        'basis=last-known-good cause=invalid announced=false ' +
        'attempts:1,applies:0,parseFailures:1,readFailures:0,fallbacks:0,importFailures:0,retries:0'
    );
  });

  /**
   * Each rejected read teaches a different fact about the counters: an
   * unreadable file is counted, a deferred bootstrap is not.
   */
  const keptCounterCases: readonly Readonly<{
    cause: 'deferred' | 'unreadable';
    description: string;
    expected: Readonly<{applies: number; parseFailures: number; readFailures: number}>;
  }>[] = [
    {
      cause: 'unreadable',
      description: 'counts an unreadable file separately from an invalid one',
      expected: {applies: 0, parseFailures: 0, readFailures: 1}
    },
    {
      cause: 'deferred',
      description: 'counts neither failure for a deferred bootstrap',
      expected: {applies: 0, parseFailures: 0, readFailures: 0}
    }
  ];

  for (const {cause, description, expected} of keptCounterCases) {
    test(description, () => {
      const {recorder, sink} = harness();

      recordImport(recorder, kept(cause === 'deferred' ? 'last-known-good' : 'empty', cause), KEPT_REPORT);

      expect(sink.info[1]).toContain(`cause=${cause}`);
      expect(recorder.counters()).toMatchObject(expected);
    });
  }

  test('counts a config fallback and names the basis it fell back to', () => {
    const {recorder, sink} = harness();

    recorder.beginImport({phase: 'reload'});
    recorder.recordImport({
      announced: false,
      configSource: 'hyper',
      fallbackBasis: 'defaults',
      outcome: applied('file'),
      phase: 'reload',
      report: {config: 'fallback', keybindings: 'applied'}
    });

    expect(sink.info[1]).toContain(
      'config=fallback configSource=hyper fallbackBasis=defaults keybindings=applied origin=file'
    );
    expect(recorder.counters()).toMatchObject({applies: 1, attempts: 1, fallbacks: 1});
  });

  test('names the fallback cause, so a parse failure differs from a read failure', () => {
    const {recorder, sink} = harness();

    recorder.beginImport({phase: 'reload'});
    recorder.recordImport({
      announced: false,
      configSource: 'development',
      fallbackBasis: 'defaults',
      outcome: applied('file'),
      phase: 'reload',
      report: {config: 'fallback', configCause: 'parse', keybindings: 'applied'}
    });

    expect(sink.info[1]).toContain(
      'config=fallback cause=parse configSource=development fallbackBasis=defaults keybindings=applied origin=file'
    );
  });

  test('omits the fallback basis when the decision is not a fallback', () => {
    const {recorder, sink} = harness();

    recordImport(recorder, applied('file'), APPLIED_REPORT);

    expect(sink.info[1]).not.toContain('fallbackBasis');
  });
});

describe('the import attempt record', () => {
  test('emits and counts an attempt before any result is known', () => {
    const {recorder, sink} = harness();

    recorder.beginImport({phase: 'startup'});

    expect(sink.info).toEqual(['[config] import attempt phase=startup']);
    expect(recorder.counters()).toMatchObject({attempts: 1, importFailures: 0});
  });

  test('does not double-count the attempt when the decision record follows', () => {
    const {recorder} = harness();

    recordImport(recorder, applied('file'), APPLIED_REPORT);

    expect(recorder.counters().attempts).toBe(1);
  });
});

describe('the import failure record', () => {
  test('counts a thrown attempt once and keeps the closed vocabulary', () => {
    const {recorder, sink} = harness();

    recorder.beginImport({phase: 'reload'});
    recorder.recordImportFailure({cause: 'thrown', phase: 'reload'});

    expect(sink.warn).toEqual([
      '[config] import failure phase=reload cause=thrown ' +
        'attempts:1,applies:0,parseFailures:0,readFailures:0,fallbacks:0,importFailures:1,retries:0'
    ]);
    expect(sink.info).toEqual(['[config] import attempt phase=reload']);
    expect(recorder.counters()).toMatchObject({attempts: 1, importFailures: 1});
  });
});

describe('the retry record', () => {
  test('emits one bounded warning per refused rename and counts it', () => {
    const {recorder, sink} = harness();

    recorder.recordRenameRetry({attempt: 1, category: 'busy', exhausted: false});
    recorder.recordRenameRetry({attempt: 2, category: 'busy', exhausted: true});

    expect(sink.warn).toEqual([
      '[config] keybindings rename attempt=1 category=busy exhausted=false',
      '[config] keybindings rename attempt=2 category=busy exhausted=true'
    ]);
    expect(sink.info).toEqual([]);
    expect(recorder.counters()).toMatchObject({attempts: 0, retries: 2});
  });
});

/** Writes the bundled defaults so the user's keybindings file is the only variable. */
const writeSources = (importer: ConfigImportHarness) => {
  writeFileSync(importer.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
  writeFileSync(importer.mockPaths.defaultPlatformKeyPath(), '{}', 'utf8');
  writeFileSync(importer.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
  mkdirpSync(importer.mockPaths.cfgDir);
  writeFileSync(
    importer.mockPaths.cfgPath,
    `{config: {defaultProfile: 'default', profiles: [{name: 'default', config: {}}]}, plugins: [], localPlugins: [], keymaps: {}}`,
    'utf8'
  );
};

describe('a reload sequence', () => {
  test('records one line per attempt across valid, invalid, and recovered files', async () => {
    const importer = await createConfigImportHarness();
    const {recorder, sink} = harness();
    try {
      writeSources(importer);
      const run = (phase: 'reload' | 'startup') => {
        recorder.beginImport({phase});
        const result = importer._import(phase);
        // Start-up never shows "Configuration updated"; only a reload can.
        const announced = phase === 'reload' && shouldAnnounceReload(result.report);
        recorder.recordImport({
          announced,
          configSource: 'velocetty',
          outcome: result.keybindings,
          phase,
          report: result.report
        });
      };

      writeFileSync(importer.mockPaths.keybindingsPath, `{'window:new': 'ctrl+n'}`, 'utf8');
      run('startup');
      writeFileSync(importer.mockPaths.keybindingsPath, `{'window:new': 'ctrl+n'`, 'utf8');
      run('reload');
      writeFileSync(importer.mockPaths.keybindingsPath, `{'window:new': 'ctrl+shift+n'}`, 'utf8');
      run('reload');

      const decisionLines = sink.info.filter((line) => line.startsWith('[config] import decision'));
      expect(decisionLines).toEqual([
        '[config] import decision phase=startup config=applied configSource=velocetty keybindings=applied origin=file ' +
          'announced=false attempts:1,applies:1,parseFailures:0,readFailures:0,fallbacks:0,importFailures:0,retries:0',
        '[config] import decision phase=reload config=applied configSource=velocetty keybindings=kept ' +
          'basis=last-known-good cause=invalid announced=false ' +
          'attempts:2,applies:1,parseFailures:1,readFailures:0,fallbacks:0,importFailures:0,retries:0',
        '[config] import decision phase=reload config=applied configSource=velocetty keybindings=applied origin=file ' +
          'announced=true attempts:3,applies:2,parseFailures:1,readFailures:0,fallbacks:0,importFailures:0,retries:0'
      ]);
    } finally {
      importer.cleanup();
    }
  });

  test('reports why the user config fell back, distinguishing parse from read', async () => {
    const importer = await createConfigImportHarness();
    try {
      writeSources(importer);
      writeFileSync(importer.mockPaths.cfgPath, '{config: ', 'utf8');
      expect(importer._import('reload').report).toMatchObject({config: 'fallback', configCause: 'parse'});

      // Removing the file makes the read itself fail, not the parse.
      rmSync(importer.mockPaths.cfgPath);
      expect(importer._import('reload').report).toMatchObject({config: 'fallback', configCause: 'read'});
    } finally {
      importer.cleanup();
    }
  });
});

describe('the counter snapshot', () => {
  test('is a copy, so a caller cannot change the running tally', () => {
    const metrics = createConfigMetrics();
    metrics.increment('attempts');

    // A snapshot is a fresh object, so mutating a caller's copy cannot reach the
    // tally the recorder still owns.
    const snapshot = metrics.snapshot();
    Object.assign(snapshot, {attempts: 99});

    expect(metrics.snapshot()).not.toBe(snapshot);
    expect(metrics.snapshot().attempts).toBe(1);
  });

  test('renders every counter in a fixed order', () => {
    expect(describeConfigCounters(createConfigMetrics().snapshot())).toBe(
      'attempts:0,applies:0,parseFailures:0,readFailures:0,fallbacks:0,importFailures:0,retries:0'
    );
  });
});
