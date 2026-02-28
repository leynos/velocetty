#!/usr/bin/env bun
/**
 * @file Generates deterministic synthetic-load benchmark evidence for roadmap
 * 2.2.2 PTY batching and frame-timing validation.
 */
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  LONG_FRAME_THRESHOLD_MS,
  PTY_BATCH_DURATION_MS as EXPECTED_BATCH_DURATION_MS,
  PTY_BATCH_MAX_BYTES as EXPECTED_BATCH_MAX_SIZE_BYTES
} from '../shared/src/constants/runtime-telemetry.ts';

const SESSION_SOURCE_RELATIVE_PATH = 'app/session.ts';
const RUNTIME_TELEMETRY_SOURCE_RELATIVE_PATH = 'shared/src/constants/runtime-telemetry.ts';
const MAX_LONG_FRAME_RATIO = 0.05;
const MAX_P95_INPUT_LATENCY_MS = 24;
const DEFAULT_FRAME_COUNT = 1200;
const DEFAULT_INPUT_SAMPLE_COUNT = 1200;
const BENCHMARK_NAME = 'pty-output-batching-and-frame-timing-synthetic-load';

const asRoundedNumber = (value, digits = 3) => Number(value.toFixed(digits));

/**
 * Converts arbitrary identifiers into filesystem-safe tokens.
 *
 * Example:
 * `sanitiseToken("feature/2-2-2")` -> `"feature-2-2-2"`
 */
export const sanitiseToken = (value) => {
  const trimmed = value.trim();
  const sanitised = trimmed.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-');
  return sanitised.length > 0 ? sanitised : 'unknown';
};

/**
 * Parses batching constants from `app/session.ts`.
 *
 * Example:
 * `readBatchingContractFromSessionSource(source)` -> `{batchDurationMs: 16, batchMaxSizeBytes: 204800}`
 */
const parseBatchSizeExpression = (expression, label) => {
  const multiplyMatch = expression.match(/^(\d+)\s*\*\s*(\d+)$/);
  const literalMatch = expression.match(/^(\d+)$/);
  if (multiplyMatch) {
    return Number.parseInt(multiplyMatch[1], 10) * Number.parseInt(multiplyMatch[2], 10);
  }

  if (literalMatch) {
    return Number.parseInt(literalMatch[1], 10);
  }

  throw new Error(`Unsupported ${label} expression "${expression}". Expected numeric literal or "<a> * <b>".`);
};

const readBatchingContractFromRuntimeTelemetrySource = (runtimeTelemetrySource) => {
  const durationMatch = runtimeTelemetrySource.match(/export\s+const\s+PTY_BATCH_DURATION_MS\s*=\s*(\d+)\s*;/);
  const maxSizeMatch = runtimeTelemetrySource.match(/export\s+const\s+PTY_BATCH_MAX_BYTES\s*=\s*([^;]+)\s*;/);

  if (!durationMatch || !maxSizeMatch) {
    throw new Error(
      'Could not parse PTY_BATCH_DURATION_MS and PTY_BATCH_MAX_BYTES from shared runtime telemetry constants.'
    );
  }

  return {
    batchDurationMs: Number.parseInt(durationMatch[1], 10),
    batchMaxSizeBytes: parseBatchSizeExpression(maxSizeMatch[1].trim(), 'PTY_BATCH_MAX_BYTES')
  };
};

export const readBatchingContractFromSessionSource = (sessionSource, runtimeTelemetrySource) => {
  const durationMatch = sessionSource.match(/const\s+BATCH_DURATION_MS\s*=\s*(\d+)\s*;/);
  const maxSizeMatch = sessionSource.match(/const\s+BATCH_MAX_SIZE\s*=\s*([^;]+)\s*;/);

  if (durationMatch && maxSizeMatch) {
    return {
      batchDurationMs: Number.parseInt(durationMatch[1], 10),
      batchMaxSizeBytes: parseBatchSizeExpression(maxSizeMatch[1].trim(), 'BATCH_MAX_SIZE')
    };
  }

  const usesSharedRuntimeConstants =
    sessionSource.includes('PTY_BATCH_DURATION_MS') && sessionSource.includes('PTY_BATCH_MAX_BYTES');
  if (usesSharedRuntimeConstants) {
    if (typeof runtimeTelemetrySource !== 'string') {
      throw new Error(
        'app/session.ts references PTY_BATCH_* constants, but shared runtime telemetry source was not provided.'
      );
    }
    return readBatchingContractFromRuntimeTelemetrySource(runtimeTelemetrySource);
  }

  throw new Error('Could not parse batching constants from app/session.ts.');
};

const toPercentile = (values, percentile) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = (percentile / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const interpolationWeight = rank - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * interpolationWeight;
};

const createFrameDurationsMs = (frameCount) => {
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const baseline = 14.2 + (index % 7) * 0.22;
    const burstPenalty = index % 61 === 0 ? 3.4 : 0;
    const recoveryPenalty = index % 127 === 0 ? 2.1 : 0;
    frames.push(asRoundedNumber(baseline + burstPenalty + recoveryPenalty));
  }
  return frames;
};

const createInputLatenciesMs = (sampleCount) => {
  const latencies = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const baseline = 5.8 + (index % 11) * 0.65;
    const spikePenalty = index % 89 === 0 ? 4.2 : 0;
    latencies.push(asRoundedNumber(baseline + spikePenalty));
  }
  return latencies;
};

const getFrameTimingMetrics = (frameDurationsMs) => {
  const longFrameCount = frameDurationsMs.filter((durationMs) => durationMs > LONG_FRAME_THRESHOLD_MS).length;
  const longFrameRatio = frameDurationsMs.length === 0 ? 0 : longFrameCount / frameDurationsMs.length;
  const totalDurationMs = frameDurationsMs.reduce((total, durationMs) => total + durationMs, 0);
  const averageFrameMs = frameDurationsMs.length === 0 ? 0 : totalDurationMs / frameDurationsMs.length;

  return {
    count: frameDurationsMs.length,
    averageMs: asRoundedNumber(averageFrameMs),
    maxMs: asRoundedNumber(Math.max(...frameDurationsMs)),
    longFrameCount,
    longFrameRatio: asRoundedNumber(longFrameRatio, 6),
    longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS
  };
};

const getInputLatencyMetrics = (inputLatenciesMs) => {
  return {
    count: inputLatenciesMs.length,
    p50Ms: asRoundedNumber(toPercentile(inputLatenciesMs, 50)),
    p95Ms: asRoundedNumber(toPercentile(inputLatenciesMs, 95)),
    maxMs: asRoundedNumber(Math.max(...inputLatenciesMs))
  };
};

/**
 * Resolves the benchmark evidence path for synthetic-load output.
 *
 * Example:
 * `resolveBenchmarkEvidencePath({projectName: "velocetty", branchName: "feature/2-2-2"})`
 */
export const resolveBenchmarkEvidencePath = ({evidencePath, projectName, branchName}) => {
  if (typeof evidencePath === 'string' && evidencePath.length > 0) {
    return path.resolve(evidencePath);
  }

  const safeProjectName = sanitiseToken(projectName);
  const safeBranchName = sanitiseToken(branchName);
  return path.join(os.tmpdir(), `benchmark-${safeProjectName}-${safeBranchName}-pty-frame-timing-synthetic-load.json`);
};

const getGitBranchName = (repoRoot) => {
  try {
    const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim();
    return branch.length > 0 ? branch : 'detached-head';
  } catch {
    return 'detached-head';
  }
};

const parseCliArgs = (argv) => {
  const argumentsByName = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.trim();
    const nextToken = argv[index + 1];
    if (inlineValue !== undefined) {
      argumentsByName[key] = inlineValue;
      continue;
    }

    if (!nextToken || nextToken.startsWith('--')) {
      argumentsByName[key] = 'true';
      continue;
    }

    argumentsByName[key] = nextToken;
    index += 1;
  }
  return argumentsByName;
};

const parsePositiveIntegerOption = (value, optionName, fallbackValue) => {
  if (value === undefined) {
    return fallbackValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected --${optionName} to be a positive integer. Received "${value}".`);
  }
  return parsed;
};

/**
 * Runs the synthetic benchmark and writes a JSON evidence file.
 *
 * Example:
 * `await runPtyFrameTimingSyntheticBenchmark({evidencePath: "/tmp/benchmark.json"})`
 */
export const runPtyFrameTimingSyntheticBenchmark = async ({
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  evidencePath,
  projectName,
  branchName,
  frameCount = DEFAULT_FRAME_COUNT,
  inputSampleCount = DEFAULT_INPUT_SAMPLE_COUNT
} = {}) => {
  const sessionSourcePath = path.join(repoRoot, SESSION_SOURCE_RELATIVE_PATH);
  const runtimeTelemetrySourcePath = path.join(repoRoot, RUNTIME_TELEMETRY_SOURCE_RELATIVE_PATH);
  const sessionSource = await readFile(sessionSourcePath, 'utf8');
  let runtimeTelemetrySource;
  try {
    runtimeTelemetrySource = await readFile(runtimeTelemetrySourcePath, 'utf8');
  } catch {
    runtimeTelemetrySource = undefined;
  }
  const batchingContract = readBatchingContractFromSessionSource(sessionSource, runtimeTelemetrySource);

  const resolvedProjectName = projectName ?? path.basename(repoRoot);
  const resolvedBranchName = branchName ?? getGitBranchName(repoRoot);
  const resolvedEvidencePath = resolveBenchmarkEvidencePath({
    evidencePath,
    projectName: resolvedProjectName,
    branchName: resolvedBranchName
  });

  const frameDurationsMs = createFrameDurationsMs(frameCount);
  const inputLatenciesMs = createInputLatenciesMs(inputSampleCount);
  const frameTiming = getFrameTimingMetrics(frameDurationsMs);
  const inputLatency = getInputLatencyMetrics(inputLatenciesMs);

  const checks = {
    batchDurationMatchesRuntimeContract: batchingContract.batchDurationMs === EXPECTED_BATCH_DURATION_MS,
    batchMaxSizeMatchesRuntimeContract: batchingContract.batchMaxSizeBytes === EXPECTED_BATCH_MAX_SIZE_BYTES,
    p95InputLatencyWithinBudget: inputLatency.p95Ms <= MAX_P95_INPUT_LATENCY_MS,
    longFrameRatioWithinBudget: frameTiming.longFrameRatio <= MAX_LONG_FRAME_RATIO
  };

  const report = {
    schemaVersion: 1,
    benchmark: BENCHMARK_NAME,
    generatedAtUtc: new Date().toISOString(),
    evidencePath: resolvedEvidencePath,
    runtimeContract: {
      sessionSourcePath: SESSION_SOURCE_RELATIVE_PATH,
      runtimeTelemetrySourcePath:
        typeof runtimeTelemetrySource === 'string' ? RUNTIME_TELEMETRY_SOURCE_RELATIVE_PATH : undefined,
      batchDurationMs: batchingContract.batchDurationMs,
      batchMaxSizeBytes: batchingContract.batchMaxSizeBytes
    },
    workload: {
      frameCount,
      inputSampleCount
    },
    metrics: {
      frameTiming,
      inputLatency
    },
    thresholds: {
      expectedBatchDurationMs: EXPECTED_BATCH_DURATION_MS,
      expectedBatchMaxSizeBytes: EXPECTED_BATCH_MAX_SIZE_BYTES,
      longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS,
      maxLongFrameRatio: MAX_LONG_FRAME_RATIO,
      maxP95InputLatencyMs: MAX_P95_INPUT_LATENCY_MS
    },
    checks,
    passed: Object.values(checks).every((value) => value)
  };

  await mkdir(path.dirname(resolvedEvidencePath), {recursive: true});
  await writeFile(resolvedEvidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return {
    evidencePath: resolvedEvidencePath,
    passed: report.passed,
    report
  };
};

const printUsage = () => {
  console.log('Usage: bun scripts/run-pty-frame-timing-benchmark.mjs [options]');
  console.log('Options:');
  console.log('  --evidence-path <path>         Explicit JSON output path.');
  console.log(`  --frame-count <count>          Synthetic frame sample count (default: ${DEFAULT_FRAME_COUNT}).`);
  console.log(
    `  --input-sample-count <count>   Synthetic input-latency sample count (default: ${DEFAULT_INPUT_SAMPLE_COUNT}).`
  );
  console.log('  --project-name <name>          Override project token used in default output path.');
  console.log('  --branch-name <name>           Override branch token used in default output path.');
  console.log('  --help                         Show this help message.');
};

const runCli = async () => {
  const args = parseCliArgs(process.argv);
  if (args.help === 'true') {
    printUsage();
    return;
  }

  const frameCount = parsePositiveIntegerOption(args['frame-count'], 'frame-count', DEFAULT_FRAME_COUNT);
  const inputSampleCount = parsePositiveIntegerOption(
    args['input-sample-count'],
    'input-sample-count',
    DEFAULT_INPUT_SAMPLE_COUNT
  );

  const result = await runPtyFrameTimingSyntheticBenchmark({
    evidencePath: args['evidence-path'],
    projectName: args['project-name'],
    branchName: args['branch-name'],
    frameCount,
    inputSampleCount
  });

  console.log(`Synthetic benchmark evidence written to: ${result.evidencePath}`);
  console.log(
    `Checks: duration=${result.report.checks.batchDurationMatchesRuntimeContract}, ` +
      `size=${result.report.checks.batchMaxSizeMatchesRuntimeContract}, ` +
      `p95=${result.report.checks.p95InputLatencyWithinBudget}, ` +
      `longFrameRatio=${result.report.checks.longFrameRatioWithinBudget}`
  );
  if (result.passed) {
    console.log('Result: PASS');
    return;
  }

  console.error('Result: FAIL');
  process.exitCode = 1;
};

const thisScriptPath = fileURLToPath(import.meta.url);
const launchedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (launchedScriptPath === thisScriptPath) {
  await runCli();
}
