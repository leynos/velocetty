import {
  LONG_FRAME_THRESHOLD_MS,
  PTY_BATCH_DURATION_MS,
  PTY_BATCH_MAX_BYTES,
  hasPtyBatchThresholdParity
} from '@shared/constants/runtime-telemetry';
import type {RendererFallbackReason, RendererRuntimeMetrics, RuntimeLatencyMetrics} from '@shared/types/common';

const rendererTypes: Record<string, string> = {};
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};
const rendererWebGLContextCounts = {current: 0, peak: 0};
const rendererRuntimeMetricsByUid: Record<string, RendererRuntimeMetrics> = {};
const inputSendToWriteLatencyByUid: Record<string, RuntimeLatencyMetrics> = {};
const isWebGLRenderer = (type: string | undefined) => type === 'WebGL';
const toKilobytes = (bytes: number) => Math.round((bytes / 1024) * 100) / 100;

const createLatencyMetrics = (): RuntimeLatencyMetrics => ({
  sampleCount: 0,
  totalMs: 0,
  maxMs: 0,
  lastMs: 0
});

const updateLatencyMetrics = (metrics: RuntimeLatencyMetrics, sampleMs: number) => {
  const sanitizedSampleMs = Math.max(0, sampleMs);
  metrics.sampleCount += 1;
  metrics.totalMs += sanitizedSampleMs;
  metrics.maxMs = Math.max(metrics.maxMs, sanitizedSampleMs);
  metrics.lastMs = sanitizedSampleMs;
};

const aggregateLatencyMetrics = (metricsCollection: RuntimeLatencyMetrics[]): RuntimeLatencyMetrics => {
  return metricsCollection.reduce<RuntimeLatencyMetrics>(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.sampleCount,
      totalMs: aggregate.totalMs + metrics.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.maxMs),
      lastMs: metrics.lastMs || aggregate.lastMs
    }),
    createLatencyMetrics()
  );
};

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

function getAggregatedRendererRuntimeMetrics() {
  const metricsByUid = Object.values(rendererRuntimeMetricsByUid);
  const aggregatedInputKeydownToSend = aggregateLatencyMetrics(
    metricsByUid.map((metrics) => metrics.inputKeydownToSend)
  );

  const aggregatedFrameTiming = metricsByUid.reduce(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.frameTiming.sampleCount,
      totalMs: aggregate.totalMs + metrics.frameTiming.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.frameTiming.maxMs),
      lastMs: metrics.frameTiming.lastMs || aggregate.lastMs,
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
  return aggregateLatencyMetrics(Object.values(inputSendToWriteLatencyByUid));
}

function setRendererRuntimeMetrics(uid: string, runtimeMetrics: RendererRuntimeMetrics) {
  rendererRuntimeMetricsByUid[uid] = runtimeMetrics;
}

function recordInputSendToWriteLatency(uid: string, sampleMs: number) {
  if (!Number.isFinite(sampleMs)) {
    return;
  }

  const metrics = inputSendToWriteLatencyByUid[uid] || createLatencyMetrics();
  updateLatencyMetrics(metrics, sampleMs);
  inputSendToWriteLatencyByUid[uid] = metrics;
}

function getPtyBatchingThresholdMetrics() {
  return {
    durationMs: PTY_BATCH_DURATION_MS,
    maxBytes: PTY_BATCH_MAX_BYTES,
    maxKilobytes: toKilobytes(PTY_BATCH_MAX_BYTES),
    parity: hasPtyBatchThresholdParity()
  };
}

function setRendererType(
  uid: string,
  type: string,
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

function unsetRendererType(uid: string) {
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
  getRendererRuntimeMetricsByUid,
  getRendererWebGLContextCounts,
  recordInputSendToWriteLatency,
  resetRendererTracking,
  setRendererRuntimeMetrics,
  setRendererType,
  unsetRendererType
};
