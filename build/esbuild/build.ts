#!/usr/bin/env bun
/** @file CLI entrypoint for esbuild bundle generation. */
import {runEsbuild, type BuildMode, type BuildTarget} from './run-esbuild';

const allowedTargets = ['hyper-app', 'renderer', 'cli'] as const;

const isBuildTarget = (value: string): value is BuildTarget => {
  return (allowedTargets as readonly string[]).includes(value);
};

const parseMode = (value: string | undefined): BuildMode => {
  if (!value) {
    return process.env.NODE_ENV === 'production' ? 'production' : 'development';
  }
  if (value === 'development' || value === 'production') {
    return value;
  }
  throw new Error(`Invalid --mode value: ${value}`);
};

const parseTargets = (value: string | undefined): BuildTarget[] => {
  if (!value || value === 'all') {
    return ['hyper-app', 'renderer', 'cli'];
  }

  const values = value
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);

  if (!values.length) {
    throw new Error('Expected at least one target for --target.');
  }

  for (const target of values) {
    if (!isBuildTarget(target)) {
      throw new Error(`Invalid target "${target}". Expected one of: ${allowedTargets.join(', ')}`);
    }
  }

  return values;
};

const parseArgs = (argv: string[]) => {
  let mode: string | undefined;
  let target: string | undefined;
  let watch = false;

  for (const argument of argv) {
    if (argument === '--watch') {
      watch = true;
      continue;
    }
    if (argument.startsWith('--mode=')) {
      mode = argument.slice('--mode='.length);
      continue;
    }
    if (argument.startsWith('--target=')) {
      target = argument.slice('--target='.length);
    }
  }

  return {
    mode: parseMode(mode),
    targets: parseTargets(target),
    watch
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await runEsbuild(options);
};

await main();
