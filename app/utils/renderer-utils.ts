import type {RendererFallbackReason} from '@shared/types/common';

const rendererTypes: Record<string, string> = {};
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};
const rendererWebGLContextCounts = {current: 0, peak: 0};
const isWebGLRenderer = (type: string | undefined) => type === 'WebGL';

function getRendererTypes() {
  return rendererTypes;
}

function getRendererFallbackReasonCounts() {
  return rendererFallbackReasonCounts;
}

function getRendererWebGLContextCounts() {
  return rendererWebGLContextCounts;
}

function setRendererType(uid: string, type: string, reason?: RendererFallbackReason) {
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
}

export {
  getRendererTypes,
  getRendererFallbackReasonCounts,
  getRendererWebGLContextCounts,
  resetRendererTracking,
  setRendererType,
  unsetRendererType
};
