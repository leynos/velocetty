import type {RendererFallbackReason} from '@shared/types/common';

const rendererTypes: Record<string, string> = {};
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};
const rendererWebGLContextCounts = {current: 0, peak: 0};

function getRendererTypes() {
  return rendererTypes;
}

function getRendererFallbackReasonCounts() {
  return rendererFallbackReasonCounts;
}

function getRendererWebGLContextCounts() {
  return rendererWebGLContextCounts;
}

function getCurrentWebGLContextCount() {
  return Object.values(rendererTypes).filter((type) => type === 'WebGL').length;
}

function syncRendererWebGLContextCounts() {
  const current = getCurrentWebGLContextCount();
  rendererWebGLContextCounts.current = current;
  rendererWebGLContextCounts.peak = Math.max(rendererWebGLContextCounts.peak, current);
}

function setRendererType(uid: string, type: string, reason?: RendererFallbackReason) {
  rendererTypes[uid] = type;
  syncRendererWebGLContextCounts();
  if (!reason) {
    return;
  }

  rendererFallbackReasonCounts[reason] = (rendererFallbackReasonCounts[reason] ?? 0) + 1;
}

function unsetRendererType(uid: string) {
  delete rendererTypes[uid];
  syncRendererWebGLContextCounts();
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
