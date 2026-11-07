/** @file Verifies the package-boundary checker rejects runtime `@shared/*` in `app/`. */
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {expect, test} from 'bun:test';

/** The checker under test; it reads `process.cwd()` as the repository root. */
const CHECKER = path.join(import.meta.dir, '..', '..', 'scripts', 'check-package-boundaries.mjs');

/**
 * Allowance for one checker run.
 *
 * Each run starts a fresh `bun` process that loads the TypeScript compiler,
 * which takes seconds and stretches further when the suite runs concurrently
 * alongside other work, so Bun's five-second default is too tight.
 */
const CHECKER_TIMEOUT_MS = 30_000;

/** One checker run's outcome, as the test needs to see it. */
type CheckResult = {
  readonly status: number;
  readonly stderr: string;
  readonly stdout: string;
};

/** Creates an isolated temporary repository root for one fixture. */
const createFixtureRoot = () => mkdtemp(path.join(tmpdir(), 'velocetty-boundaries-'));

/** Writes a fixture source file, creating its parent directory as needed. */
const writeFixture = async (rootDir: string, relativePath: string, content: string) => {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
};

/** Runs the checker against `rootDir` and captures its exit status and output. */
const runChecker = (rootDir: string): CheckResult => {
  const result = spawnSync(process.execPath, [CHECKER], {cwd: rootDir, encoding: 'utf8'});
  return {status: result.status ?? 1, stderr: result.stderr, stdout: result.stdout};
};

/** Runs the checker over one `app/` fixture and returns its outcome. */
const checkAppFixture = async (fixtureName: string, content: string): Promise<CheckResult> => {
  const rootDir = await createFixtureRoot();
  try {
    await writeFixture(rootDir, `app/${fixtureName}`, content);
    return runChecker(rootDir);
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
};

test(
  'a type-only import of @shared from app/ passes',
  async () => {
    const result = await checkAppFixture(
      'type-only.ts',
      "import type {A} from '@shared/types/config';\nimport {type B} from '@shared/types/other';\nexport type Both = A | B;\n"
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Package boundary check passed.');
  },
  CHECKER_TIMEOUT_MS
);

test(
  'a runtime import of @shared from app/ fails with the packaging reason',
  async () => {
    const result = await checkAppFixture('runtime.ts', "import {a} from '@shared/x';\nconsole.log(a);\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime `@shared/*` import in app/');
  },
  CHECKER_TIMEOUT_MS
);

test(
  'a mixed type and value import of @shared from app/ fails',
  async () => {
    // The value binding survives compilation, so the clause is not type-only
    // even though it also carries a type import.
    const result = await checkAppFixture('mixed.ts', "import {type A, b} from '@shared/x';\nconsole.log(b);\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime `@shared/*` import in app/');
  },
  CHECKER_TIMEOUT_MS
);

test(
  'a two-argument dynamic import of @shared from app/ is analysed',
  async () => {
    // `import('x', {with: {type: 'json'}})` names its module in the first
    // argument; skipping the two-argument form would let it through.
    const result = await checkAppFixture(
      'dynamic.ts',
      "const load = () => import('@shared/x', {with: {type: 'json'}});\nexport {load};\n"
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime `@shared/*` import in app/');
  },
  CHECKER_TIMEOUT_MS
);
