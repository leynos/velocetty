/** @file Verifies synthetic PTY frame-timing benchmark evidence generation. */
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {expect, test} from 'bun:test';
import {LONG_FRAME_THRESHOLD_MS} from '@shared/constants/runtime-telemetry';
import {z} from 'zod';

import {
  readBatchingContractFromSessionSource,
  resolveBenchmarkEvidencePath,
  runPtyFrameTimingSyntheticBenchmark,
  sanitizeToken
} from '../../scripts/run-pty-frame-timing-benchmark.mjs';

const reportSchema = z.object({
  benchmark: z.string(),
  runtimeContract: z.object({
    sessionSourcePath: z.string(),
    runtimeTelemetrySourcePath: z.string().optional(),
    batchDurationMs: z.number(),
    batchMaxSizeBytes: z.number()
  }),
  workload: z.object({frameCount: z.number(), inputSampleCount: z.number()}),
  checks: z.object({
    batchDurationMatchesRuntimeContract: z.boolean(),
    batchMaxSizeMatchesRuntimeContract: z.boolean(),
    p95InputLatencyWithinBudget: z.boolean(),
    longFrameRatioWithinBudget: z.boolean()
  }),
  thresholds: z.object({longFrameThresholdMs: z.number()}),
  passed: z.boolean()
});

test('sanitizeToken normalizes unsafe path characters', () => {
  expect(sanitizeToken('feature/2-2-2 pty')).toBe('feature-2-2-2-pty');
  expect(sanitizeToken('   ')).toBe('unknown');
  expect(sanitizeToken('ok_name')).toBe('ok_name');
});

test('readBatchingContractFromSessionSource parses numeric and multiplied values', () => {
  const source = ['const BATCH_DURATION_MS = 16;', 'const BATCH_MAX_SIZE = 200 * 1024;'].join('\n');

  expect(readBatchingContractFromSessionSource(source)).toEqual({
    batchDurationMs: 16,
    batchMaxSizeBytes: 200 * 1024
  });
});

test('readBatchingContractFromSessionSource supports shared PTY batching constants', () => {
  const sessionSource = `import {PTY_BATCH_DURATION_MS, PTY_BATCH_MAX_BYTES} from '@shared/constants/runtime-telemetry';`;
  const runtimeTelemetrySource = [
    'export const PTY_BATCH_DURATION_MS = 16;',
    'export const PTY_BATCH_MAX_BYTES = 200 * 1024;'
  ].join('\n');

  expect(readBatchingContractFromSessionSource(sessionSource, runtimeTelemetrySource)).toEqual({
    batchDurationMs: 16,
    batchMaxSizeBytes: 200 * 1024
  });
});

test('resolveBenchmarkEvidencePath builds branch-safe default path', () => {
  const evidencePath = resolveBenchmarkEvidencePath({
    projectName: 'velocetty',
    branchName: 'feature/2-2-2'
  });

  expect(evidencePath).toBe(
    path.join(tmpdir(), 'benchmark-velocetty-feature-2-2-2-pty-frame-timing-synthetic-load.json')
  );
});

test('runPtyFrameTimingSyntheticBenchmark writes deterministic evidence JSON', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'velocetty-benchmark-'));

  try {
    const evidencePath = path.join(tempDir, 'synthetic-benchmark.json');
    const result = await runPtyFrameTimingSyntheticBenchmark({
      evidencePath,
      frameCount: 240,
      inputSampleCount: 320
    });

    expect(result.passed).toBe(true);
    expect(result.evidencePath).toBe(evidencePath);

    const report = reportSchema.parse(JSON.parse(await readFile(evidencePath, 'utf8')));

    expect(report.benchmark).toBe('pty-output-batching-and-frame-timing-synthetic-load');
    expect(report.runtimeContract).toEqual({
      sessionSourcePath: 'app/session.ts',
      runtimeTelemetrySourcePath: 'shared/src/constants/runtime-telemetry.ts',
      batchDurationMs: 16,
      batchMaxSizeBytes: 200 * 1024
    });
    expect(report.workload).toEqual({
      frameCount: 240,
      inputSampleCount: 320
    });
    expect(report.checks).toEqual({
      batchDurationMatchesRuntimeContract: true,
      batchMaxSizeMatchesRuntimeContract: true,
      p95InputLatencyWithinBudget: true,
      longFrameRatioWithinBudget: true
    });
    expect(report.thresholds.longFrameThresholdMs).toBe(LONG_FRAME_THRESHOLD_MS);
    expect(report.passed).toBe(true);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});
