import type {RendererFallbackReason} from '@shared/types/common';

const rendererTypes: Record<string, string> = {};
const rendererFallbackReasonCounts: Partial<Record<RendererFallbackReason, number>> = {};

function getRendererTypes() {
  return rendererTypes;
}

function getRendererFallbackReasonCounts() {
  return rendererFallbackReasonCounts;
}

function setRendererType(uid: string, type: string, reason?: RendererFallbackReason) {
  rendererTypes[uid] = type;
  if (!reason) {
    return;
  }

  rendererFallbackReasonCounts[reason] = (rendererFallbackReasonCounts[reason] ?? 0) + 1;
}

function unsetRendererType(uid: string) {
  delete rendererTypes[uid];
}

export {getRendererTypes, getRendererFallbackReasonCounts, setRendererType, unsetRendererType};
