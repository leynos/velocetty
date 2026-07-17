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
  RuntimeLatencyMetrics
} from '@shared/types/common';

const rendererTypes: Record<string, RendererType> = Object.create(null);
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};
const rendererWebGLContextCounts = {current: 0, peak: 0};
const rendererRuntimeMetricsByUid: Record<string, RendererRuntimeMetrics> = Object.create(null);
const inputSendToWriteLatencyByUid: Record<string, RuntimeLatencyMetrics> = Object.create(null);
const isWebGLRenderer = (type: RendererType | undefined): type is 'WebGL' => type === 'WebGL';
const toKilobytes = (bytes: number) => Math.round((bytes / 1024) * 100) / 100;

/** Returns a zeroed latency metrics accumulator. */
const createRuntimeLatencyMetrics = (): RuntimeLatencyMetrics => ({
  sampleCount: 0,
  totalMs: 0,
  maxMs: 0,
  lastMs: 0
});

/** Returns the current renderer type (e.g. WebGL, canvas) for each tracked renderer, by uid. */
function getRendererTypes() {
  return rendererTypes;
}

/** Returns how many times each renderer fallback reason has been recorded. */
function getRendererFallbackReasonCounts() {
  return rendererFallbackReasonCounts;
}

/** Returns the current and peak count of concurrently active WebGL renderer contexts. */
function getRendererWebGLContextCounts() {
  return {
    /** Number of WebGL renderer contexts currently active. */
    current: rendererWebGLContextCounts.current,
    /** Highest number of concurrently active WebGL renderer contexts observed. */
    peak: rendererWebGLContextCounts.peak
  };
}

/** Returns the last-reported runtime metrics for each tracked renderer, by uid. */
function getRendererRuntimeMetricsByUid() {
  return rendererRuntimeMetricsByUid;
}

/** Returns input-send-to-pty-write latency metrics for each tracked renderer, by uid. */
function getInputSendToWriteLatencyByUid() {
  return inputSendToWriteLatencyByUid;
}

/** Aggregates per-renderer runtime metrics into a single summary, for the About dialog. */
function getAggregatedRendererRuntimeMetrics() {
  const metricsByUid = Object.values(rendererRuntimeMetricsByUid);
  const aggregatedInputKeydownToSend = metricsByUid.reduce<RuntimeLatencyMetrics>(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.inputKeydownToSend.sampleCount,
      totalMs: aggregate.totalMs + metrics.inputKeydownToSend.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.inputKeydownToSend.maxMs),
      lastMs: metrics.inputKeydownToSend.lastMs ?? aggregate.lastMs
    }),
    createRuntimeLatencyMetrics()
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
      /** Number of frame-timing samples aggregated. */
      sampleCount: 0,
      /** Sum of all sampled frame durations, in milliseconds. */
      totalMs: 0,
      /** Longest sampled frame duration, in milliseconds. */
      maxMs: 0,
      /** Most recently sampled frame duration, in milliseconds. */
      lastMs: 0,
      /** Number of frames that exceeded the long-frame threshold. */
      longFrameCount: 0,
      /** Threshold, in milliseconds, above which a frame is considered long. */
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
    /** Aggregated keydown-to-send latency across all tracked renderers. */
    inputKeydownToSend: aggregatedInputKeydownToSend,
    /** Aggregated frame-timing statistics across all tracked renderers. */
    frameTiming: aggregatedFrameTiming,
    /** The most recent timestamp (ms) any tracked renderer reported metrics. */
    updatedAtMs: latestUpdateAtMs,
    /** The longest reporting interval (ms) observed across tracked renderers. */
    reportIntervalMs
  };
}

/** Aggregates input-send-to-pty-write latency across all tracked renderers. */
function getAggregatedInputSendToWriteLatencyMetrics() {
  return Object.values(inputSendToWriteLatencyByUid).reduce<RuntimeLatencyMetrics>(
    (aggregate, metrics) => ({
      sampleCount: aggregate.sampleCount + metrics.sampleCount,
      totalMs: aggregate.totalMs + metrics.totalMs,
      maxMs: Math.max(aggregate.maxMs, metrics.maxMs),
      lastMs: metrics.lastMs ?? aggregate.lastMs
    }),
    createRuntimeLatencyMetrics()
  );
}

/** Records the latest runtime metrics report for a renderer. */
function setRendererRuntimeMetrics(uid: RendererUid, runtimeMetrics: RendererRuntimeMetrics) {
  rendererRuntimeMetricsByUid[uid] = runtimeMetrics;
}

/** Records a single input-send-to-pty-write latency sample for a renderer. */
function recordInputSendToWriteLatency(uid: RendererUid, sampleMs: number) {
  if (!Number.isFinite(sampleMs)) {
    return;
  }

  const metrics = inputSendToWriteLatencyByUid[uid] || createRuntimeLatencyMetrics();
  const sanitizedSampleMs = Math.max(0, sampleMs);
  metrics.sampleCount += 1;
  metrics.totalMs += sanitizedSampleMs;
  metrics.maxMs = Math.max(metrics.maxMs, sanitizedSampleMs);
  metrics.lastMs = sanitizedSampleMs;
  inputSendToWriteLatencyByUid[uid] = metrics;
}

/** Reports the active PTY batching thresholds, and whether they match the build's expected values. */
function getPtyBatchingThresholdMetrics(runtimeThresholds?: {durationMs: number; maxBytes: number}) {
  const durationMs = runtimeThresholds?.durationMs ?? PTY_BATCH_DURATION_MS;
  const maxBytes = runtimeThresholds?.maxBytes ?? PTY_BATCH_MAX_BYTES;
  const parity =
    runtimeThresholds === undefined
      ? hasPtyBatchThresholdParity()
      : durationMs === PTY_BATCH_EXPECTED_DURATION_MS && maxBytes === PTY_BATCH_EXPECTED_MAX_BYTES;

  return {
    /** Time window, in milliseconds, pty output is batched over before flushing. */
    durationMs,
    /** Maximum bytes buffered before a batch is flushed early. */
    maxBytes,
    /** `maxBytes` expressed in kilobytes, for display. */
    maxKilobytes: toKilobytes(maxBytes),
    /** Whether these thresholds match the build's expected constants. */
    parity
  };
}

/** Tracks a renderer's active type, updating WebGL context counts and fallback reason tallies. */
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

/** Clears tracking state for a renderer that has been unloaded, adjusting WebGL context counts. */
function unsetRendererType(uid: RendererUid) {
  if (isWebGLRenderer(rendererTypes[uid])) {
    rendererWebGLContextCounts.current = Math.max(0, rendererWebGLContextCounts.current - 1);
  }

  delete rendererTypes[uid];
  delete rendererRuntimeMetricsByUid[uid];
  delete inputSendToWriteLatencyByUid[uid];
}

/** Clears all renderer tracking state; intended for tests. */
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
