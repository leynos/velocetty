/** @file Derives pane visibility from active-tab state, bounds, and occlusion. */

export type PaneLayoutBounds = Readonly<{
  width: number;
  height: number;
}>;

export type PaneVisibilityInput = Readonly<{
  isActiveTab: boolean;
  bounds: PaneLayoutBounds | null | undefined;
  isOccluded: boolean;
}>;

/**
 * Reports whether `bounds` describe a pane with area worth rendering.
 *
 * `bounds` is optional because the function answers `false` for absence: an
 * unmeasured pane has no renderable area, and making every caller spell out
 * that fact would only repeat the branch inside.
 */
export const hasRenderablePaneBounds = (bounds?: PaneLayoutBounds | null) => {
  if (!bounds) {
    return false;
  }

  return Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0;
};

export const isPaneVisible = (input: PaneVisibilityInput) => {
  return input.isActiveTab && !input.isOccluded && hasRenderablePaneBounds(input.bounds);
};
