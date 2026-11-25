#!/usr/bin/env bun
/**
 * @file Verifies that every committed `.dfy.gen` matches a fresh generation.
 *
 * LemmaScript's `.dfy.gen` files are generated artefacts. Nobody may edit them
 * by hand: a hand edit changes the merge base that `lsc regen` uses and can
 * silently discard proof work. This check regenerates each listed file and
 * compares the result with the committed copy, restoring the committed copy
 * afterwards so the working tree is unchanged whether the check passes or
 * fails.
 *
 * Run through `make proofs-fresh`, which `make lint` invokes.
 */
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const proofListPath = 'LemmaScript-files.txt';
const rootDir = process.cwd();

/**
 * Reads the proof list, dropping comments and blank lines.
 *
 * @param {string} text - Raw proof-list content.
 * @returns {string[]} Repository-relative TypeScript file paths.
 */
const parseProofList = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0]);

/**
 * Replaces a `.ts` suffix with the generated-artefact suffix.
 *
 * @param {string} sourcePath - Repository-relative TypeScript path.
 * @param {string} suffix - Suffix to append after removing `.ts`.
 * @returns {string} The artefact path.
 */
const artefactPath = (sourcePath, suffix) => `${sourcePath.replace(/\.ts$/, '')}${suffix}`;

/**
 * Regenerates one proof artefact and reports whether it matches the commit.
 *
 * @param {string} sourcePath - Repository-relative TypeScript path.
 * @returns {{isFresh: boolean, expected: string, actual: string}} The verdict
 * and both generations for reporting.
 */
const checkOne = (sourcePath) => {
  const genPath = artefactPath(sourcePath, '.dfy.gen');
  const basePath = artefactPath(sourcePath, '.dfy.base');
  const mergedPath = artefactPath(sourcePath, '.dfy.merged');
  const hadBase = existsSync(basePath);
  const hadMerged = existsSync(mergedPath);
  const expected = readFileSync(genPath, 'utf8');
  const result = spawnSync('bunx', ['lsc', 'gen', '--backend=dafny', sourcePath], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    writeFileSync(genPath, expected);
    throw new Error(`lsc gen failed for ${sourcePath}:\n${result.stderr}${result.stdout}`);
  }
  const actual = readFileSync(genPath, 'utf8');
  // A differing generation makes `gen` archive the previous one as a merge
  // base. Remove only files this run created, so a pending `regen` merge in
  // the working tree is never damaged.
  if (!hadBase) {
    rmSync(basePath, {force: true});
  }
  if (!hadMerged) {
    rmSync(mergedPath, {force: true});
  }
  writeFileSync(genPath, expected);
  return {isFresh: expected === actual, expected, actual};
};

/**
 * Prints the first differing lines, numbered, for a stale artefact.
 *
 * @param {string} genPath - Artefact path being reported.
 * @param {string} expected - Committed content.
 * @param {string} actual - Regenerated content.
 */
const reportMismatch = (genPath, expected, actual) => {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const limit = Math.max(expectedLines.length, actualLines.length);
  console.error(`${genPath} differs from a fresh generation:`);
  let shown = 0;
  for (let index = 0; index < limit && shown < 20; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      console.error(`  line ${index + 1}`);
      console.error(`    committed: ${expectedLines[index] ?? '<end of file>'}`);
      console.error(`    generated: ${actualLines[index] ?? '<end of file>'}`);
      shown += 1;
    }
  }
};

const proofFiles = parseProofList(readFileSync(proofListPath, 'utf8'));
if (proofFiles.length === 0) {
  console.log(`No files listed in ${proofListPath}; skipping proof freshness.`);
  process.exit(0);
}

let failed = false;
for (const sourcePath of proofFiles) {
  const {isFresh, expected, actual} = checkOne(sourcePath);
  if (!isFresh) {
    failed = true;
    reportMismatch(artefactPath(sourcePath, '.dfy.gen'), expected, actual);
    console.error(`Regenerate it with 'bunx lsc regen --backend=dafny ${sourcePath}'.`);
  }
}

if (failed) {
  process.exit(1);
}
console.log('Generated Dafny artefacts are current.');
