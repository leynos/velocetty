/** @file Verifies the CLI dispatches named commands instead of launching Hyper. */
import {describe, expect, test} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dir, '..', '..');
const cliEntryPoint = path.join(repositoryRoot, 'cli', 'index.ts');
const packageVersion =
  // SAFETY: `app/package.json` is a repository file whose `version` field is a
  // string; the assertion in the first test pins that expectation.
  (JSON.parse(readFileSync(path.join(repositoryRoot, 'app', 'package.json'), 'utf8')) as {readonly version: string})
    .version;

type CliResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Runs the CLI in a child process.
 *
 * A subprocess is required rather than an in-process import: the entry point
 * dispatches on `process.argv` at module scope, so importing it would execute
 * a command against the test runner's own arguments.
 *
 * @param argv - Command arguments, excluding the executable and entry point.
 * @returns The captured exit status and output streams.
 */
const runCli = (argv: readonly string[]): CliResult => {
  const result = spawnSync('bun', [cliEntryPoint, ...argv], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
};

describe('named command dispatch', () => {
  test('reports the version and exits successfully', () => {
    const result = runCli(['version']);

    expect(result.stdout.trim()).toBe(packageVersion);
    expect(result.status).toBe(0);
    // A command that never records completion falls through to the default
    // action, which reports the command name as a missing directory.
    expect(result.stderr).not.toContain('does not exist');
  });

  test('reports a missing directory once for the default action', () => {
    const result = runCli([path.join(repositoryRoot, 'no-such-directory')]);

    expect(result.status).toBe(1);
    expect(result.stderr.match(/does not exist/g)).toHaveLength(1);
  });
});
