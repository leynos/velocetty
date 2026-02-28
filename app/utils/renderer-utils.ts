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
  RuntimeLatencyMetrics
} from '@shared/types/common';

const rendererTypes: Record<string, RendererType> = {};
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};
const rendererWebGLContextCounts = {current: 0, peak: 0};
const rendererRuntimeMetricsByUid: Record<string, RendererRuntimeMetrics> = {};
const inputSendToWriteLatencyByUid: Record<string, RuntimeLatencyMetrics> = {};
const isWebGLRenderer = (type: RendererType | undefined): type is 'WebGL' => type === 'WebGL';
const toKilobytes = (bytes: number) => Math.round((bytes / 1024) * 100) / 100;

const createEmptyLatencyMetrics = (): RuntimeLatencyMetrics => ({
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
  const aggregatedInputKeydownToSend = metricsByUid.reduce<RuntimeLatencyMetrics>(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.inputKeydownToSend.sampleCount,
      totalMs: aggregate.totalMs + metrics.inputKeydownToSend.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.inputKeydownToSend.maxMs),
      lastMs: metrics.inputKeydownToSend.lastMs ?? aggregate.lastMs
    }),
    createEmptyLatencyMetrics()
  );

  const aggregatedFrameTiming = metricsByUid.reduce(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.frameTiming.sampleCount,
      totalMs: aggregate.totalMs + metrics.frameTiming.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.frameTiming.maxMs),
      lastMs: metrics.frameTiming.lastMs ?? aggregate.lastMs,
      longFrameCount: aggregate.longFrameCount + metrics.frameTiming.longFrameCount,
      longFrameThresholdMs: Math.max(aggregate.longFrameThresholdMs, metrics.frameTiming.longFrameThresholdMs)
    }),
    {
      sampleCount: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      longFrameCount: 0,
      longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS
    }
  );

  const latestUpdateAtMs = metricsByUid.reduce(
    (latestTimestamp, metrics) => Math.max(latestTimestamp, metrics.updatedAtMs),
    0
  );
  const reportIntervalMs = metricsByUid.reduce(
    (latestInterval, metrics) => Math.max(latestInterval, metrics.reportIntervalMs),
    0
  );

  return {
    inputKeydownToSend: aggregatedInputKeydownToSend,
    frameTiming: aggregatedFrameTiming,
    updatedAtMs: latestUpdateAtMs,
    reportIntervalMs
  };
}

function getAggregatedInputSendToWriteLatencyMetrics() {
  return Object.values(inputSendToWriteLatencyByUid).reduce<RuntimeLatencyMetrics>(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.sampleCount,
      totalMs: aggregate.totalMs + metrics.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.maxMs),
      lastMs: metrics.lastMs ?? aggregate.lastMs
    }),
    createEmptyLatencyMetrics()
  );
}

function setRendererRuntimeMetrics(uid: RendererUid, runtimeMetrics: RendererRuntimeMetrics) {
  rendererRuntimeMetricsByUid[uid] = runtimeMetrics;
}

function recordInputSendToWriteLatency(uid: RendererUid, sampleMs: number) {
  if (!Number.isFinite(sampleMs)) {
    return;
  }

  const metrics = inputSendToWriteLatencyByUid[uid] || createEmptyLatencyMetrics();
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
    delete rendererFallbackReasonCounts[reason as RendererFallbackReason];
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
