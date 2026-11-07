/** @file Negative tests for `bin/prove.sh`, which must refuse a vacuous success. */
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {expect, test} from 'bun:test';

const REPOSITORY_ROOT = path.join(import.meta.dir, '..', '..');
const PROVE_SCRIPT = path.join(REPOSITORY_ROOT, 'bin', 'prove.sh');

/** The policy proof source the guard insists on seeing in the list. */
const POLICY_SOURCE = 'app/config/keybindings-policy.ts';

/** A generated artefact whose body carries no trust construct. */
const GENERATED_STUB = 'lemma Generated()\n  ensures true\n{\n}\n';

/** The rule line that opens and closes a generated artefact's module header. */
const HEADER_RULE = `// ${'-'.repeat(66)}`;

/** One generated artefact, whose body defaults to a trust-free stub. */
type GeneratedArtefact = Readonly<{
  readonly body?: string;
  readonly headerLine: string;
}>;

/**
 * A generated artefact whose header is prose copied from its TypeScript module.
 *
 * The scan skips that header, because a summary may legitimately mention a word
 * the proof body must never contain.
 */
const generatedWithHeader = ({body = GENERATED_STUB, headerLine}: GeneratedArtefact): string =>
  [HEADER_RULE, `// ${headerLine}`, HEADER_RULE, body].join('\n');

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

/** A fixture repository the guards run inside. */
type Fixture = Readonly<{
  readonly root: string;
}>;

/** An executable stub to place in the fixture. */
type StubFile = Readonly<{
  readonly body: string;
  readonly filePath: string;
}>;

/** Writes an executable stub, so a guard can run without the real tool. */
const writeStub = ({body, filePath}: StubFile) => {
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
const createFixture = (): Fixture => {
  const fixture: Fixture = {root: mkdtempSync(path.join(tmpdir(), 'velocetty-prove-'))};
  mkdirSync(path.join(fixture.root, 'bin'), {recursive: true});
  mkdirSync(path.join(fixture.root, 'test', 'proofs'), {recursive: true});
  copyFileSync(PROVE_SCRIPT, path.join(fixture.root, 'bin', 'prove.sh'));
  // The wrapper regeneration step only has to succeed and leave the tracked
  // artefacts unchanged; the fixture keeps those artefacts untouched.
  writeFileSync(path.join(fixture.root, 'bin', 'generate-dafny.mjs'), 'export {};\n', 'utf8');
  writeStub({body: '#!/usr/bin/env bash\necho "4.11.0"\n', filePath: path.join(fixture.root, 'fake-bin', 'dafny')});
  writeStub({body: '#!/usr/bin/env bash\nexit 0\n', filePath: path.join(fixture.root, 'fake-bin', 'z3')});
  writeStub({
    body:
      '#!/usr/bin/env bash\n' +
      "count=$(grep -cvE '^[[:space:]]*(#|$)' LemmaScript-files.txt)\n" +
      'for ((i = 0; i < count; i += 1)); do\n' +
      '  echo "Dafny program verifier finished with 1 verified, 0 errors"\n' +
      'done\n',
    filePath: path.join(fixture.root, 'node_modules', '.bin', 'lsc')
  });
  execFileSync('git', ['init', '-q'], {cwd: fixture.root, env: withoutGitEnv(process.env)});
  return fixture;
};

/** A fixture source file to write, whose content defaults to a comment. */
type SourceFile = Readonly<{
  readonly content?: string;
  readonly relativePath: string;
}>;

/** Writes one fixture source file, creating its directories. */
const writeSource = (fixture: Fixture, {content = '// fixture source\n', relativePath}: SourceFile) => {
  const filePath = path.join(fixture.root, relativePath);
  mkdirSync(path.dirname(filePath), {recursive: true});
  writeFileSync(filePath, content, 'utf8');
};

/** Writes the proof-source list the guards read. */
const writeList = (fixture: Fixture, lines: readonly string[]) => {
  writeFileSync(path.join(fixture.root, 'LemmaScript-files.txt'), `${lines.join('\n')}\n`, 'utf8');
};

/**
 * Runs one test inside a fixture it owns outright.
 *
 * Per-test ownership means a failing assertion cannot leave a directory behind
 * or let one test observe another's files.
 */
const inFixture = (body: (fixture: Fixture) => void): void => {
  const fixture = createFixture();
  try {
    body(fixture);
  } finally {
    rmSync(fixture.root, {force: true, recursive: true});
  }
};

/** Adds the policy source, so the guard's policy check is satisfiable. */
const addPolicySource = (fixture: Fixture): void => {
  writeSource(fixture, {relativePath: POLICY_SOURCE});
};

/** Runs the script against a policy fixture with the given list contents. */
const runWithList = (fixture: Fixture, lines: readonly string[]) => {
  addPolicySource(fixture);
  writeList(fixture, lines);
  return runProve(fixture);
};

/** The Dafny pair a proof run installs for the policy source. */
type ProofFiles = Readonly<{
  readonly dafnySource: string;
  readonly generated?: string;
}>;

/** Runs the script against a policy fixture carrying the given Dafny proofs. */
const runWithProof = (fixture: Fixture, {dafnySource, generated = GENERATED_STUB}: ProofFiles) => {
  addPolicySource(fixture);
  writeSource(fixture, {content: dafnySource, relativePath: 'app/config/keybindings-policy.dfy'});
  writeSource(fixture, {content: generated, relativePath: 'app/config/keybindings-policy.dfy.gen'});
  writeList(fixture, [POLICY_SOURCE]);
  return runProve(fixture);
};

/** Runs the script in its fixture and captures the refusal it produced. */
const runProve = (fixture: Fixture) => {
  const result = spawnSync('bash', ['bin/prove.sh'], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...withoutGitEnv(process.env),
      PATH: `${path.join(fixture.root, 'fake-bin')}:${process.env.PATH ?? ''}`
    }
  });
  return {status: result.status ?? 1, stderr: result.stderr, stdout: result.stdout};
};

test('prove refuses a missing proof-source list', () => {
  inFixture((fixture) => {
    const result = runProve(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing LemmaScript-files.txt.');
  });
});

test('prove refuses a list with no proof sources', () => {
  inFixture((fixture) => {
    const result = runWithList(fixture, ['# only a comment']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lists no proof sources');
  });
});

test('prove refuses a listed source that does not exist', () => {
  inFixture((fixture) => {
    const result = runWithList(fixture, ['app/config/absent.ts']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Listed proof source 'app/config/absent.ts' does not exist.");
  });
});

test('prove refuses a non-integer timeout', () => {
  inFixture((fixture) => {
    const result = runWithList(fixture, [`${POLICY_SOURCE} soon`]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Timeout 'soon' for '${POLICY_SOURCE}' is not an integer.`);
  });
});

test('prove refuses a timeout long enough for lsc to downgrade the check', () => {
  inFixture((fixture) => {
    const result = runWithList(fixture, [`${POLICY_SOURCE} 61`]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exceeds the 60s limit');
  });
});

test('prove refuses text after the timeout column', () => {
  // The list has two columns; a third word would otherwise be silently ignored.
  inFixture((fixture) => {
    const result = runWithList(fixture, [`${POLICY_SOURCE} 10 typo`]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Unexpected text 'typo' after the timeout for '${POLICY_SOURCE}'.`);
  });
});

test('prove refuses to skip the policy proof when the policy exists unlisted', () => {
  inFixture((fixture) => {
    writeSource(fixture, {relativePath: POLICY_SOURCE});
    writeSource(fixture, {relativePath: 'app/config/other.ts'});
    writeList(fixture, ['app/config/other.ts']);

    const result = runProve(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${POLICY_SOURCE} exists but is not listed`);
  });
});

test('prove refuses a forbidden Dafny trust construct', () => {
  inFixture((fixture) => {
    const result = runWithProof(fixture, {dafnySource: 'lemma Bad()\n  ensures false\n{\n  assume false;\n}\n'});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Forbidden Dafny trust construct found');
  });
});

test('prove refuses a spaced axiom attribute that is not the admitted one', () => {
  // Dafny accepts whitespace inside an attribute, so `{: axiom }` must not slip
  // past the comparison against the one admitted line.
  inFixture((fixture) => {
    const result = runWithProof(fixture, {dafnySource: 'function {: axiom } emptyUserKeymaps(): UserKeymaps\n'});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Forbidden Dafny trust construct found');
  });
});

test('prove refuses a spaced verify-false attribute', () => {
  inFixture((fixture) => {
    const result = runWithProof(fixture, {dafnySource: 'lemma Bad()\n  ensures true\n  {: verify false }\n{\n}\n'});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Forbidden Dafny trust construct found');
  });
});

test('prove refuses a trust construct in a generated artefact body', () => {
  inFixture((fixture) => {
    const result = runWithProof(fixture, {
      dafnySource: '// hand-authored proof\n',
      generated: generatedWithHeader({body: 'lemma Bad()\n{\n  assume false;\n}\n', headerLine: 'Generated proof.'})
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Forbidden Dafny trust construct found');
  });
});

test('prove ignores a trust word in a generated artefact header', () => {
  // The header is copied from the TypeScript module's prose summary, so a word
  // the scan forbids there is a description, not a proof step.
  inFixture((fixture) => {
    const result = runWithProof(fixture, {
      dafnySource: '// hand-authored proof\n',
      generated: generatedWithHeader({headerLine: 'Assumes the user keymaps are empty.'})
    });

    expect(result.status).toBe(0);
  });
});

test('prove ignores a hand-authored proof outside the policy directory', () => {
  // The list is authoritative, so a proof listed from elsewhere is still
  // scanned; this pins that the scan follows the list rather than a fixed path.
  inFixture((fixture) => {
    writeSource(fixture, {relativePath: POLICY_SOURCE});
    writeSource(fixture, {content: GENERATED_STUB, relativePath: 'app/config/keybindings-policy.dfy.gen'});
    writeSource(fixture, {relativePath: 'test/proofs/other.ts'});
    writeSource(fixture, {content: 'lemma Other()\n{\n  assume false;\n}\n', relativePath: 'test/proofs/other.dfy'});
    writeSource(fixture, {content: GENERATED_STUB, relativePath: 'test/proofs/other.dfy.gen'});
    writeList(fixture, [POLICY_SOURCE, 'test/proofs/other.ts']);

    const result = runProve(fixture);

    expect(result.status).toBe(1);
    // The refusal prints the offending line, which only this proof contains.
    expect(result.stderr).toContain('assume false;');
  });
});

test('prove admits only the emptyUserKeymaps axiom and then verifies', () => {
  inFixture((fixture) => {
    const result = runWithProof(fixture, {dafnySource: 'function {:axiom} emptyUserKeymaps(): UserKeymaps\n'});

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Dafny program verifier finished with 1 verified, 0 errors');
  });
});
