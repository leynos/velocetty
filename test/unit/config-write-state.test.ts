/**
 * @file Direct tests for the process-wide config write state.
 *
 * The revision counter orders snapshots, and the recorded text hash is how the
 * watcher recognises the application's own write. Both are shared by the
 * writer and the watcher, so a regression here would silently disable
 * self-write detection.
 */
import {afterEach, describe, expect, test} from 'bun:test';

import {
  currentConfigRevision,
  getLastWrittenTextHash,
  hashConfigText,
  nextConfigRevision,
  recordWrittenText,
  resetConfigWriteState
} from '../../app/config/config-write-state';

afterEach(() => {
  resetConfigWriteState();
});

describe('config write state', () => {
  test('revisions start at zero and increase by one', () => {
    expect(currentConfigRevision()).toBe(0);
    const firstRevision = nextConfigRevision();
    const secondRevision = nextConfigRevision();
    expect([firstRevision, secondRevision]).toEqual([1, 2]);
    expect(currentConfigRevision()).toBe(2);
  });

  test('recording text stores its hash, not the text', () => {
    expect(getLastWrittenTextHash()).toBeNull();
    recordWrittenText('{config: {fontSize: 16}}');
    const storedHash = getLastWrittenTextHash();
    expect(storedHash).toBe(hashConfigText('{config: {fontSize: 16}}'));
    expect(storedHash).not.toContain('fontSize');
  });

  test('reset clears both values for an isolated test', () => {
    nextConfigRevision();
    recordWrittenText('{}');
    resetConfigWriteState();
    expect(currentConfigRevision()).toBe(0);
    expect(getLastWrittenTextHash()).toBeNull();
  });
});
