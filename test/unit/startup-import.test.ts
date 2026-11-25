/** @file Pins the start-up sequence: capture stamps, prepare, import, settle. */
/*
 * The watcher baseline is only trustworthy if it was captured before the
 * import read the files and settled only for the files the import wrote.
 * These examples drive the sequence with plain functions, so a reordering is
 * caught here rather than reconstructed from the composition root's behaviour.
 *
 * Cross-links:
 * - Source: `app/config/startup-import.ts`
 * - Stamps: `app/config/watched-file-stamp.ts`
 */
import {describe, expect, mock, test} from 'bun:test';

import type {ConfigImportResult} from '../../app/config/import';
import {runStartupImport, type StartupImportDependencies} from '../../app/config/startup-import';
import type {WatchedFileStamps, WrittenWatchedFile} from '../../app/config/watched-file-stamp';
import {makeParsedConfig} from '../testUtils/config-watch-harness';

const CAPTURED: WatchedFileStamps = new Map([['/tmp/config.json5', {kind: 'absent'}]]);
const SETTLED: WatchedFileStamps = new Map([['/tmp/config.json5', {kind: 'unreadable'}]]);

/** The import result a start-up run returns, including the files it wrote. */
const importedResult = (): ConfigImportResult => ({
  config: makeParsedConfig({'window:new': ['ctrl+n']}),
  keybindings: {keymaps: {}, kind: 'applied', origin: 'file'},
  report: {config: 'applied', keybindings: 'applied'},
  writtenFiles: [{path: '/tmp/keybindings.json5', text: '{}\n'}]
});

/** Records the order the sequence calls its collaborators in. */
const createRecorder = () => {
  const calls: string[] = [];
  return {calls};
};

/** The dependencies a case drives, with the order recorded as they run. */
const createDependencies = (calls: string[], imported: ConfigImportResult): StartupImportDependencies => ({
  captureStamps: () => {
    calls.push('capture');
    return CAPTURED;
  },
  prepare: () => {
    calls.push('prepare');
  },
  importConfiguration: () => {
    calls.push('import');
    return imported;
  },
  settleStamps: () => {
    calls.push('settle');
    return SETTLED;
  }
});

describe('runStartupImport', () => {
  test('captures the baseline before the import and settles after it', () => {
    const recorder = createRecorder();
    const imported = importedResult();

    const outcome = runStartupImport(createDependencies(recorder.calls, imported));

    expect(recorder.calls).toEqual(['capture', 'prepare', 'import', 'settle']);
    expect(outcome.imported).toBe(imported);
    expect(outcome.startupStamps).toBe(SETTLED);
  });

  test('settles against the captured baseline and the files the import wrote', () => {
    const imported = importedResult();
    const settleStamps = mock((_stamps: WatchedFileStamps, _writtenFiles: readonly WrittenWatchedFile[]) => SETTLED);

    runStartupImport({...createDependencies([], imported), settleStamps});

    const [stamps, writtenFiles] = settleStamps.mock.calls[0] ?? [];
    expect(stamps).toBe(CAPTURED);
    expect(writtenFiles).toEqual(imported.writtenFiles);
  });

  test('propagates a thrown import without settling the baseline', () => {
    const failure = new Error('import failed');
    const settleStamps = mock((_stamps: WatchedFileStamps, _writtenFiles: readonly WrittenWatchedFile[]) => SETTLED);
    const dependencies: StartupImportDependencies = {
      ...createDependencies([], importedResult()),
      importConfiguration: () => {
        throw failure;
      },
      settleStamps
    };

    expect(() => runStartupImport(dependencies)).toThrow(failure);
    // A crashed start-up starts no watcher, so no file may be settled for it.
    expect(settleStamps).not.toHaveBeenCalled();
  });
});
