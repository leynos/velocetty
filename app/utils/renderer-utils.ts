/** @file Renderer tracking state and runtime telemetry aggregation helpers. */
import {
  LONG_FRAME_THRESHOLD_MS,
  PTY_BATCH_DURATION_MS,
  PTY_BATCH_EXPECTED_DURATION_MS,
  PTY_BATCH_EXPECTED_MAX_BYTES,
  PTY_BATCH_MAX_BYTES,
  hasPtyBatchThresholdParity
} from '../constants/runtime-telemetry';
import type {
  RendererFallbackReason,
  RendererRuntimeMetrics,
  RendererType,
  RendererUid,
  RuntimeFrameTimingMetrics,
  RuntimeLatencyMetrics
} from '@shared/types/common';

const rendererTypes: Record<string, RendererType> = Object.create(null);
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};
const rendererWebGLContextCounts = {current: 0, peak: 0};
const rendererRuntimeMetricsByUid: Record<string, RendererRuntimeMetrics> = Object.create(null);
const inputSendToWriteLatencyByUid: Partial<Record<string, RuntimeLatencyMetrics>> = Object.create(null);
const isWebGLRenderer = (type: RendererType | undefined): type is 'WebGL' => type === 'WebGL';
const isRendererFallbackReason = (value: string): value is RendererFallbackReason =>
  value === 'context-loss' || value === 'pool-evicted' || value === 'webgl-init-failed';
const toKilobytes = (bytes: number) => Math.round((bytes / 1024) * 100) / 100;

const createRuntimeLatencyMetrics = (): RuntimeLatencyMetrics => ({
  sampleCount: 0,
  totalMs: 0,
  maxMs: 0,
  lastMs: 0
});

function getRendererTypes() {
  return rendererTypes;
}

function getRendererFallbackReasonCounts() {
  return rendererFallbackReasonCounts;
}

function getRendererWebGLContextCounts() {
  return {
    current: rendererWebGLContextCounts.current,
    peak: rendererWebGLContextCounts.peak
  };
}

function getRendererRuntimeMetricsByUid() {
  return rendererRuntimeMetricsByUid;
}

function getInputSendToWriteLatencyByUid() {
  return inputSendToWriteLatencyByUid;
}

function getAggregatedRendererRuntimeMetrics() {
  const metricsByUid = Object.values(rendererRuntimeMetricsByUid);
  const aggregatedInputKeydownToSend = createRuntimeLatencyMetrics();
  const aggregatedFrameTiming: RuntimeFrameTimingMetrics = {
    sampleCount: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    longFrameCount: 0,
    longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS
  };
  let latestUpdateAtMs = 0;
  let reportIntervalMs = 0;

  for (const metrics of metricsByUid) {
    const inputMetrics = metrics.inputKeydownToSend;
    aggregatedInputKeydownToSend.sampleCount += inputMetrics.sampleCount;
    aggregatedInputKeydownToSend.totalMs += inputMetrics.totalMs;
    aggregatedInputKeydownToSend.maxMs = Math.max(aggregatedInputKeydownToSend.maxMs, inputMetrics.maxMs);
    aggregatedInputKeydownToSend.lastMs = inputMetrics.lastMs;

    const frameMetrics = metrics.frameTiming;
    aggregatedFrameTiming.sampleCount += frameMetrics.sampleCount;
    aggregatedFrameTiming.totalMs += frameMetrics.totalMs;
    aggregatedFrameTiming.maxMs = Math.max(aggregatedFrameTiming.maxMs, frameMetrics.maxMs);
    aggregatedFrameTiming.lastMs = frameMetrics.lastMs;
    aggregatedFrameTiming.longFrameCount += frameMetrics.longFrameCount;
    aggregatedFrameTiming.longFrameThresholdMs = Math.max(
      aggregatedFrameTiming.longFrameThresholdMs,
      frameMetrics.longFrameThresholdMs
    );

    latestUpdateAtMs = Math.max(latestUpdateAtMs, metrics.updatedAtMs);
    reportIntervalMs = Math.max(reportIntervalMs, metrics.reportIntervalMs);
  }

  return {
    inputKeydownToSend: aggregatedInputKeydownToSend,
    frameTiming: aggregatedFrameTiming,
    updatedAtMs: latestUpdateAtMs,
    reportIntervalMs
  };
}

function getAggregatedInputSendToWriteLatencyMetrics() {
  const aggregate = createRuntimeLatencyMetrics();
  for (const metrics of Object.values(inputSendToWriteLatencyByUid)) {
    aggregate.sampleCount += metrics.sampleCount;
    aggregate.totalMs += metrics.totalMs;
    aggregate.maxMs = Math.max(aggregate.maxMs, metrics.maxMs);
    aggregate.lastMs = metrics.lastMs;
  }
  return aggregate;
}

function setRendererRuntimeMetrics(uid: RendererUid, runtimeMetrics: RendererRuntimeMetrics) {
  rendererRuntimeMetricsByUid[uid] = runtimeMetrics;
}

function recordInputSendToWriteLatency(uid: RendererUid, sampleMs: number) {
  if (!Number.isFinite(sampleMs)) {
    return;
  }

  const metrics = inputSendToWriteLatencyByUid[uid] ?? createRuntimeLatencyMetrics();
  const sanitizedSampleMs = Math.max(0, sampleMs);
  metrics.sampleCount += 1;
  metrics.totalMs += sanitizedSampleMs;
  metrics.maxMs = Math.max(metrics.maxMs, sanitizedSampleMs);
  metrics.lastMs = sanitizedSampleMs;
  inputSendToWriteLatencyByUid[uid] = metrics;
}

function getPtyBatchingThresholdMetrics(runtimeThresholds?: {durationMs: number; maxBytes: number}) {
  const durationMs = runtimeThresholds?.durationMs ?? PTY_BATCH_DURATION_MS;
  const maxBytes = runtimeThresholds?.maxBytes ?? PTY_BATCH_MAX_BYTES;
  const parity =
    runtimeThresholds === undefined
      ? hasPtyBatchThresholdParity()
      : durationMs === PTY_BATCH_EXPECTED_DURATION_MS && maxBytes === PTY_BATCH_EXPECTED_MAX_BYTES;

  return {
    durationMs,
    maxBytes,
    maxKilobytes: toKilobytes(maxBytes),
    parity
  };
}

function setRendererType(
  uid: RendererUid,
  type: RendererType,
  reason?: RendererFallbackReason,
  runtimeMetrics?: RendererRuntimeMetrics
) {
  const previousType = rendererTypes[uid];
  const wasWebGL = isWebGLRenderer(previousType);
  const isWebGL = isWebGLRenderer(type);

  if (!wasWebGL && isWebGL) {
    rendererWebGLContextCounts.current += 1;
    rendererWebGLContextCounts.peak = Math.max(rendererWebGLContextCounts.peak, rendererWebGLContextCounts.current);
  } else if (wasWebGL && !isWebGL) {
    rendererWebGLContextCounts.current = Math.max(0, rendererWebGLContextCounts.current - 1);
  }

  rendererTypes[uid] = type;
  if (runtimeMetrics) {
    setRendererRuntimeMetrics(uid, runtimeMetrics);
  }
  if (!reason) {
    return;
  }

  rendererFallbackReasonCounts[reason] = (rendererFallbackReasonCounts[reason] ?? 0) + 1;
}

function unsetRendererType(uid: RendererUid) {
  if (isWebGLRenderer(rendererTypes[uid])) {
    rendererWebGLContextCounts.current = Math.max(0, rendererWebGLContextCounts.current - 1);
  }

  delete rendererTypes[uid];
  delete rendererRuntimeMetricsByUid[uid];
  delete inputSendToWriteLatencyByUid[uid];
}

function resetRendererTracking() {
  for (const uid of Object.keys(rendererTypes)) {
    delete rendererTypes[uid];
  }

  for (const reason of Object.keys(rendererFallbackReasonCounts)) {
    if (isRendererFallbackReason(reason)) {
      delete rendererFallbackReasonCounts[reason];
    }
  }

  rendererWebGLContextCounts.current = 0;
  rendererWebGLContextCounts.peak = 0;

  for (const uid of Object.keys(rendererRuntimeMetricsByUid)) {
    delete rendererRuntimeMetricsByUid[uid];
  }

  for (const uid of Object.keys(inputSendToWriteLatencyByUid)) {
    delete inputSendToWriteLatencyByUid[uid];
  }
}

export {
  createRuntimeLatencyMetrics,
  getAggregatedInputSendToWriteLatencyMetrics,
  getAggregatedRendererRuntimeMetrics,
  getPtyBatchingThresholdMetrics,
  getRendererTypes,
  getRendererFallbackReasonCounts,
  getInputSendToWriteLatencyByUid,
  getRendererRuntimeMetricsByUid,
  getRendererWebGLContextCounts,
  recordInputSendToWriteLatency,
  resetRendererTracking,
  setRendererRuntimeMetrics,
  setRendererType,
  unsetRendererType
};
