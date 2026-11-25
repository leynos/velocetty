#!/usr/bin/env bun
/**
 * @file Verifies that every committed `.dfy.gen` matches a fresh generation.
 *
 * `bin/generate-dafny.mjs` is the project's generator: it runs `lsc gen` and
 * prepends each source's module header. This check regenerates every listed
 * artefact through that wrapper, compares the result with the committed copy,
 * and restores the committed copy afterwards so the working tree is unchanged
 * whether the check passes or fails. Generating through the wrapper matters:
 * a raw `lsc gen` omits the header the shipped artefact carries, so comparing
 * against it would fail every file rather than a stale one.
 *
 * Run through `make proofs-fresh`, which `make lint` invokes.
 */
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

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

/** The committed generation of every listed artefact, keyed by its path. */
const committed = new Map(
  proofFiles.map((sourcePath) => {
    const genPath = artefactPath(sourcePath, '.dfy.gen');
    return [genPath, readFileSync(genPath, 'utf8')];
  })
);

// `lsc gen` archives a differing previous generation as a merge base. Remember
// which of those files existed first, so only this run's leftovers are removed
// and a pending `regen` merge in the working tree is never damaged.
const auxiliaryPaths = proofFiles.flatMap((sourcePath) => [
  artefactPath(sourcePath, '.dfy.base'),
  artefactPath(sourcePath, '.dfy.merged')
]);
const preexistingAuxiliary = new Set(auxiliaryPaths.filter((candidate) => existsSync(candidate)));

/**
 * Puts every committed artefact back and removes only this run's leftovers.
 *
 * Runs on both paths: a failed generation must not leave a half-rewritten
 * artefact or a stray merge base behind for the next gate to trip over.
 */
const restoreCommitted = () => {
  for (const [genPath, text] of committed) {
    writeFileSync(genPath, text);
  }
  for (const candidate of auxiliaryPaths) {
    if (!preexistingAuxiliary.has(candidate)) {
      rmSync(candidate, {force: true});
    }
  }
};

let generationFailed = false;
try {
  execFileSync('bun', ['bin/generate-dafny.mjs'], {cwd: rootDir, encoding: 'utf8', stdio: 'pipe'});
} catch (error) {
  generationFailed = true;
  console.error(`bun bin/generate-dafny.mjs failed:\n${error.stderr ?? ''}${error.stdout ?? ''}`);
}

let failed = generationFailed;
if (!generationFailed) {
  for (const [genPath, expected] of committed) {
    const actual = readFileSync(genPath, 'utf8');
    if (expected !== actual) {
      failed = true;
      reportMismatch(genPath, expected, actual);
      console.error(`Regenerate it with 'bun bin/generate-dafny.mjs' and commit the result.`);
    }
  }
}

restoreCommitted();

if (failed) {
  process.exit(1);
}
console.log('Generated Dafny artefacts are current.');
