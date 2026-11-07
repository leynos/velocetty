/** @file Negative tests for `bin/prove.sh`, which must refuse a vacuous success. */
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, expect, test} from 'bun:test';

const REPOSITORY_ROOT = path.join(import.meta.dir, '..', '..');
const PROVE_SCRIPT = path.join(REPOSITORY_ROOT, 'bin', 'prove.sh');

/** Fixture repositories created by the current test, removed afterwards. */
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, {force: true, recursive: true});
  }
});

/**
 * Git variables that would point a fixture at the outer repository.
 *
 * Git exports `GIT_DIR` to hooks, so a test that runs under the pre-push hook
 * would otherwise make the fixture's `git diff` inspect the real worktree.
 */
const GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_PREFIX'
] as const;

/** Copies the environment without the variables that bind it to a repository. */
const withoutGitEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const cleaned = {...env};
  for (const key of GIT_ENV_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
};

/** Writes an executable stub, so a guard can run without the real tool. */
const writeStub = (filePath: string, body: string) => {
  mkdirSync(path.dirname(filePath), {recursive: true});
  writeFileSync(filePath, body, 'utf8');
  chmodSync(filePath, 0o755);
};

/**
 * Builds a repository-shaped fixture whose tooling is stubbed.
 *
 * The guards run before verification, so a stub `dafny`, `z3`, and `lsc` are
 * enough for every failure case; the happy-path test also gives the stub `lsc`
 * the one summary line the script insists on seeing.
 */
const createFixture = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'velocetty-prove-'));
  fixtures.push(root);
  mkdirSync(path.join(root, 'bin'), {recursive: true});
  mkdirSync(path.join(root, 'test', 'proofs'), {recursive: true});
  copyFileSync(PROVE_SCRIPT, path.join(root, 'bin', 'prove.sh'));
  // The wrapper regeneration step only has to succeed and leave the tracked
  // artefacts unchanged; the fixture keeps those artefacts untouched.
  writeFileSync(path.join(root, 'bin', 'generate-dafny.mjs'), 'export {};\n', 'utf8');
  writeStub(path.join(root, 'fake-bin', 'dafny'), '#!/usr/bin/env bash\necho "4.11.0"\n');
  writeStub(path.join(root, 'fake-bin', 'z3'), '#!/usr/bin/env bash\nexit 0\n');
  writeStub(
    path.join(root, 'node_modules', '.bin', 'lsc'),
    '#!/usr/bin/env bash\n' +
      "count=$(grep -cvE '^[[:space:]]*(#|$)' LemmaScript-files.txt)\n" +
      'for ((i = 0; i < count; i += 1)); do\n' +
      '  echo "Dafny program verifier finished with 1 verified, 0 errors"\n' +
      'done\n'
  );
  execFileSync('git', ['init', '-q'], {cwd: root, env: withoutGitEnv(process.env)});
  return root;
};

/** Writes one fixture source file, creating its directories. */
const writeSource = (root: string, relativePath: string, content = '// fixture source\n') => {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), {recursive: true});
  writeFileSync(filePath, content, 'utf8');
};

/** Writes the proof-source list the guards read. */
const writeList = (root: string, lines: readonly string[]) => {
  writeFileSync(path.join(root, 'LemmaScript-files.txt'), `${lines.join('\n')}\n`, 'utf8');
};

/** Runs the script in its fixture and captures the refusal it produced. */
const runProve = (root: string) => {
  const result = spawnSync('bash', ['bin/prove.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...withoutGitEnv(process.env),
      PATH: `${path.join(root, 'fake-bin')}:${process.env.PATH ?? ''}`
    }
  });
  return {status: result.status ?? 1, stderr: result.stderr, stdout: result.stdout};
};

test('prove refuses a missing proof-source list', () => {
  const result = runProve(createFixture());

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Missing LemmaScript-files.txt.');
});

test('prove refuses a list with no proof sources', () => {
  const root = createFixture();
  writeList(root, ['# only a comment']);

  const result = runProve(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('lists no proof sources');
});

test('prove refuses a listed source that does not exist', () => {
  const root = createFixture();
  writeList(root, ['app/config/absent.ts']);

  const result = runProve(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Listed proof source 'app/config/absent.ts' does not exist.");
});

test('prove refuses a non-integer timeout', () => {
  const root = createFixture();
  writeSource(root, 'app/config/keybindings-policy.ts');
  writeList(root, ['app/config/keybindings-policy.ts soon']);

  const result = runProve(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Timeout 'soon' for 'app/config/keybindings-policy.ts' is not an integer.");
});

test('prove refuses a timeout long enough for lsc to downgrade the check', () => {
  const root = createFixture();
  writeSource(root, 'app/config/keybindings-policy.ts');
  writeList(root, ['app/config/keybindings-policy.ts 61']);

  const result = runProve(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('exceeds the 60s limit');
});

test('prove refuses to skip the policy proof when the policy exists unlisted', () => {
  const root = createFixture();
  writeSource(root, 'app/config/keybindings-policy.ts');
  writeSource(root, 'app/config/other.ts');
  writeList(root, ['app/config/other.ts']);

  const result = runProve(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('app/config/keybindings-policy.ts exists but is not listed');
});

test('prove refuses a forbidden Dafny trust construct', () => {
  const root = createFixture();
  writeSource(root, 'app/config/keybindings-policy.ts');
  writeSource(root, 'app/config/keybindings-policy.dfy', 'lemma Bad()\n  ensures false\n{\n  assume false;\n}\n');
  writeSource(root, 'app/config/keybindings-policy.dfy.gen', 'lemma Generated()\n  ensures true\n{\n}\n');
  writeList(root, ['app/config/keybindings-policy.ts']);

  const result = runProve(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Forbidden Dafny trust construct found');
});

test('prove admits only the emptyUserKeymaps axiom and then verifies', () => {
  const root = createFixture();
  writeSource(root, 'app/config/keybindings-policy.ts');
  writeSource(root, 'app/config/keybindings-policy.dfy', 'function {:axiom} emptyUserKeymaps(): UserKeymaps\n');
  writeSource(root, 'app/config/keybindings-policy.dfy.gen', 'lemma Generated()\n  ensures true\n{\n}\n');
  writeList(root, ['app/config/keybindings-policy.ts']);

  const result = runProve(root);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Dafny program verifier finished with 1 verified, 0 errors');
});
