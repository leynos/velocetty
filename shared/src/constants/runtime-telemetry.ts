/** @file Shared runtime telemetry constants and lightweight metric helpers. */
import type {RendererUid} from '../types/common';

/** PTY output batching interval in milliseconds. */
export const PTY_BATCH_DURATION_MS = 16;
/** PTY output batching ceiling in bytes (200KB). */
export const PTY_BATCH_MAX_BYTES = 200 * 1024;
/** Canonical PTY batching interval expected by roadmap 2.2.2. */
export const PTY_BATCH_EXPECTED_DURATION_MS = 16;
/** Canonical PTY batching ceiling expected by roadmap 2.2.2. */
export const PTY_BATCH_EXPECTED_MAX_BYTES = 200 * 1024;

/** Long-frame threshold used by renderer frame-timing instrumentation. */
export const LONG_FRAME_THRESHOLD_MS = 16;
/** Runtime metric reporting cadence from renderer to main process. */
export const RUNTIME_METRICS_REPORT_INTERVAL_MS = 1000;

export const INPUT_SEND_TIMESTAMP_QUEUE_LIMIT = 128;
const inputSendTimestampsByUid = new Map<RendererUid, number[]>();

export const getOrCreateTimestampQueue = (uid: RendererUid) => {
  const queue = inputSendTimestampsByUid.get(uid);
  if (queue) {
    return queue;
  }

  const newQueue: number[] = [];
  inputSendTimestampsByUid.set(uid, newQueue);
  return newQueue;
};

/** Returns true when the configured PTY batching thresholds match canonical values. */
export const hasPtyBatchThresholdParity = () =>
  PTY_BATCH_DURATION_MS === PTY_BATCH_EXPECTED_DURATION_MS && PTY_BATCH_MAX_BYTES === PTY_BATCH_EXPECTED_MAX_BYTES;

/** Enqueues renderer-side input send timestamps so actions can forward them to main-process metrics ingestion. */
export const enqueueInputSendTimestamp = (uid: RendererUid, timestampMs: number) => {
  if (!uid || !Number.isFinite(timestampMs)) {
    return;
  }

  const queue = getOrCreateTimestampQueue(uid);
  queue.push(timestampMs);

  if (queue.length > INPUT_SEND_TIMESTAMP_QUEUE_LIMIT) {
    queue.splice(0, queue.length - INPUT_SEND_TIMESTAMP_QUEUE_LIMIT);
  }
};

/** Dequeues the oldest pending renderer-side input send timestamp for a session. */
export const dequeueInputSendTimestamp = (uid: RendererUid) => {
  const queue = inputSendTimestampsByUid.get(uid);
  if (!queue || queue.length === 0) {
    return undefined;
  }

  const timestamp = queue.shift();
  if (queue.length === 0) {
    inputSendTimestampsByUid.delete(uid);
  }

  return timestamp;
};

/** Clears any pending renderer-side input send timestamps for a session. */
export const clearInputSendTimestamps = (uid: RendererUid) => {
  inputSendTimestampsByUid.delete(uid);
};

/** Resets all pending renderer-side input send timestamps across sessions. */
export const resetInputSendTimestamps = () => {
  inputSendTimestampsByUid.clear();
};
