/** @file Verifies synthetic PTY frame-timing benchmark evidence generation. */
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {expect, test} from 'bun:test';

import {
  readBatchingContractFromSessionSource,
  resolveBenchmarkEvidencePath,
  runPtyFrameTimingSyntheticBenchmark,
  sanitiseToken
} from '../../scripts/run-pty-frame-timing-benchmark.mjs';

test('sanitiseToken normalises unsafe path characters', () => {
  expect(sanitiseToken('feature/2-2-2 pty')).toBe('feature-2-2-2-pty');
  expect(sanitiseToken('   ')).toBe('unknown');
  expect(sanitiseToken('ok_name')).toBe('ok_name');
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

  expect(evidencePath).toBe('/tmp/benchmark-velocetty-feature-2-2-2-pty-frame-timing-synthetic-load.json');
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

    const report = JSON.parse(await readFile(evidencePath, 'utf8')) as {
      benchmark: string;
      runtimeContract: {
        sessionSourcePath: string;
        runtimeTelemetrySourcePath?: string;
        batchDurationMs: number;
        batchMaxSizeBytes: number;
      };
      workload: {
        frameCount: number;
        inputSampleCount: number;
      };
      checks: {
        batchDurationMatchesRuntimeContract: boolean;
        batchMaxSizeMatchesRuntimeContract: boolean;
        p95InputLatencyWithinBudget: boolean;
        longFrameRatioWithinBudget: boolean;
      };
      passed: boolean;
    };

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
    expect(report.passed).toBe(true);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});
