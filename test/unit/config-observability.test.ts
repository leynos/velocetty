/** @file The bounded decision record, retry record, and counters for an import. */
import {describe, expect, test} from 'bun:test';

import {mkdirpSync, writeFileSync} from 'fs-extra';

import {createConfigMetrics, describeConfigCounters} from '../../app/config/config-metrics';
import {createImportRecorder} from '../../app/config/config-observability';
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
const KEPT_REPORT: ConfigImportReport = {config: 'applied', keybindings: 'kept'};

describe('the import decision record', () => {
  test('names the origin of an applied file and counts one apply', () => {
    const {recorder, sink} = harness();

    recorder.recordImport({announced: true, outcome: applied('file'), phase: 'reload', report: APPLIED_REPORT});

    expect(sink.info).toEqual([
      '[config] import decision phase=reload config=applied keybindings=applied origin=file announced=true ' +
        'attempts:1,applies:1,parseFailures:0,readFailures:0,fallbacks:0,retries:0'
    ]);
    expect(sink.warn).toEqual([]);
    expect(recorder.counters()).toEqual({
      applies: 1,
      attempts: 1,
      fallbacks: 0,
      parseFailures: 0,
      readFailures: 0,
      retries: 0
    });
  });

  test('separates an empty file from a first-run seed by origin alone', () => {
    const {recorder, sink} = harness();

    recorder.recordImport({announced: false, outcome: applied('missing'), phase: 'startup', report: APPLIED_REPORT});
    recorder.recordImport({announced: false, outcome: applied('seeded'), phase: 'startup', report: APPLIED_REPORT});
    recorder.recordImport({
      announced: false,
      outcome: applied('seeded-unsaved'),
      phase: 'startup',
      report: APPLIED_REPORT
    });

    expect(sink.info.map((line) => line.split(' announced=')[0])).toEqual([
      '[config] import decision phase=startup config=applied keybindings=applied origin=missing',
      '[config] import decision phase=startup config=applied keybindings=applied origin=seeded',
      '[config] import decision phase=startup config=applied keybindings=applied origin=seeded-unsaved'
    ]);
    // A seed that could not be written still applied in memory.
    expect(recorder.counters().applies).toBe(3);
  });

  test('counts a parse failure as a kept outcome, not a fallback', () => {
    const {recorder, sink} = harness();

    recorder.recordImport({
      announced: false,
      outcome: kept('last-known-good', 'invalid'),
      phase: 'reload',
      report: KEPT_REPORT
    });

    expect(sink.info[0]).toBe(
      '[config] import decision phase=reload config=applied keybindings=kept basis=last-known-good cause=invalid ' +
        'announced=false attempts:1,applies:0,parseFailures:1,readFailures:0,fallbacks:0,retries:0'
    );
  });

  test('counts an unreadable file separately from an invalid one', () => {
    const {recorder} = harness();

    recorder.recordImport({
      announced: false,
      outcome: kept('empty', 'unreadable'),
      phase: 'reload',
      report: KEPT_REPORT
    });

    expect(recorder.counters()).toMatchObject({applies: 0, parseFailures: 0, readFailures: 1});
  });

  test('counts neither failure for a deferred bootstrap', () => {
    const {recorder, sink} = harness();

    recorder.recordImport({
      announced: false,
      outcome: kept('last-known-good', 'deferred'),
      phase: 'reload',
      report: KEPT_REPORT
    });

    expect(sink.info[0]).toContain('cause=deferred');
    expect(recorder.counters()).toMatchObject({applies: 0, parseFailures: 0, readFailures: 0});
  });

  test('counts a config fallback while still reporting the keybindings outcome', () => {
    const {recorder, sink} = harness();

    recorder.recordImport({
      announced: false,
      outcome: applied('file'),
      phase: 'reload',
      report: {config: 'fallback', keybindings: 'applied'}
    });

    expect(sink.info[0]).toContain('config=fallback keybindings=applied origin=file');
    expect(recorder.counters()).toMatchObject({applies: 1, attempts: 1, fallbacks: 1});
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
        const result = importer._import(phase);
        // Start-up never shows "Configuration updated"; only a reload can.
        const announced = phase === 'reload' && shouldAnnounceReload(result.report);
        recorder.recordImport({announced, outcome: result.keybindings, phase, report: result.report});
      };

      writeFileSync(importer.mockPaths.keybindingsPath, `{'window:new': 'ctrl+n'}`, 'utf8');
      run('startup');
      writeFileSync(importer.mockPaths.keybindingsPath, `{'window:new': 'ctrl+n'`, 'utf8');
      run('reload');
      writeFileSync(importer.mockPaths.keybindingsPath, `{'window:new': 'ctrl+shift+n'}`, 'utf8');
      run('reload');

      expect(sink.info).toEqual([
        '[config] import decision phase=startup config=applied keybindings=applied origin=file announced=false ' +
          'attempts:1,applies:1,parseFailures:0,readFailures:0,fallbacks:0,retries:0',
        '[config] import decision phase=reload config=applied keybindings=kept basis=last-known-good cause=invalid ' +
          'announced=false attempts:2,applies:1,parseFailures:1,readFailures:0,fallbacks:0,retries:0',
        '[config] import decision phase=reload config=applied keybindings=applied origin=file announced=true ' +
          'attempts:3,applies:2,parseFailures:1,readFailures:0,fallbacks:0,retries:0'
      ]);
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
      'attempts:0,applies:0,parseFailures:0,readFailures:0,fallbacks:0,retries:0'
    );
  });
});
