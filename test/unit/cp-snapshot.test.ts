/** @file Covers the V8 snapshot copy hook's missing-artefact behaviour. */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {copySnapshot, getSnapshotPaths, resolveContextArch} from '../../bin/cp-snapshot.mjs';

/** Root of the throwaway cache tree each test builds and removes. */
let cacheRoot = '';
/** Destination standing in for an unpacked application directory. */
let destinationDir = '';

const writeSnapshotArch = (arch: string, blobContents?: string, contextContents?: string) => {
  const {pathToBlob, pathToBlobV8} = getSnapshotPaths(arch, cacheRoot);
  fs.mkdirSync(path.dirname(pathToBlob), {recursive: true});
  if (blobContents !== undefined) fs.writeFileSync(pathToBlob, blobContents);
  if (contextContents !== undefined) fs.writeFileSync(pathToBlobV8, contextContents);
};

const destinationEntries = () => fs.readdirSync(destinationDir).toSorted();

beforeEach(() => {
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-snapshot-cache-'));
  destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-snapshot-dest-'));
});

afterEach(() => {
  fs.rmSync(cacheRoot, {recursive: true, force: true});
  fs.rmSync(destinationDir, {recursive: true, force: true});
});

describe('resolveContextArch', () => {
  test('reads a string architecture from the afterPack context', () => {
    expect(resolveContextArch({arch: 'x64'})).toBe('x64');
    expect(resolveContextArch({arch: 'aarch64'})).toBe('arm64');
  });

  test('reads an electron-builder Arch enum from the afterPack context', () => {
    expect(resolveContextArch({arch: 3})).toBe('arm64');
    expect(resolveContextArch({arch: 1})).toBe('x64');
  });

  test('reports an undetermined architecture rather than the host’s', () => {
    // A runner that packs several architectures also carries its own, so
    // falling back to the host would silently select the wrong one. The hook
    // treats an unknown target like absent artefacts and keeps Electron's
    // default snapshot.
    expect(resolveContextArch({})).toBeUndefined();
    expect(resolveContextArch({arch: undefined})).toBeUndefined();
    expect(resolveContextArch({arch: null})).toBeUndefined();
    expect(resolveContextArch({arch: 99})).toBeUndefined();
  });

  test('rejects an architecture that is present but unusable', () => {
    expect(() => resolveContextArch({arch: 'sparc'})).toThrow(/Unsupported architecture "sparc"/);
    expect(() => resolveContextArch({arch: {}})).toThrow(/Unsupported context.arch value/);
  });
});

describe('copySnapshot', () => {
  test('copies both artefacts when the requested architecture is present', () => {
    writeSnapshotArch('x64', 'blob', 'v8-context');

    copySnapshot(destinationDir, 'x64', cacheRoot);

    const {snapshotFileName, v8ContextFileName} = getSnapshotPaths('x64', cacheRoot);
    expect(fs.readFileSync(path.join(destinationDir, snapshotFileName), 'utf8')).toBe('blob');
    expect(fs.readFileSync(path.join(destinationDir, v8ContextFileName), 'utf8')).toBe('v8-context');
  });

  test('leaves the destination untouched when an architecture was never snapshotted', () => {
    // The macOS case: an arm64 runner generates only arm64 artefacts, while
    // the x64 target still needs packing. Electron's bundled default snapshot
    // is the supported fallback, so the hook must copy nothing rather than
    // reach for another architecture's build.
    writeSnapshotArch('arm64', 'arm-blob', 'arm-v8-context');

    copySnapshot(destinationDir, 'x64', cacheRoot);

    expect(destinationEntries()).toEqual([]);
  });

  test('throws when only some of an architecture’s artefacts exist', () => {
    // A partial directory is a failed generation, not an unsupported host, so
    // it must stay loud instead of silently falling back.
    writeSnapshotArch('x64', 'blob');

    expect(() => copySnapshot(destinationDir, 'x64', cacheRoot)).toThrow(/Incomplete snapshot output/);
    expect(destinationEntries()).toEqual([]);
  });
});
