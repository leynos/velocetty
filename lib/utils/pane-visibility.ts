/** @file Derives pane visibility from active-tab state, bounds, and occlusion. */

/** Measured size of a pane's layout box. */
export type PaneLayoutBounds = Readonly<{
  /** Pane width in pixels. */
  width: number;
  /** Pane height in pixels. */
  height: number;
}>;

/** Inputs used to decide whether a pane should currently be rendered. */
export type PaneVisibilityInput = Readonly<{
  /** Whether the pane's tab is the active tab. */
  isActiveTab: boolean;
  /** The pane's current layout bounds, if measured. */
  bounds: PaneLayoutBounds | null | undefined;
  /** Whether the pane is occluded (e.g. hidden behind another window or overlay). */
  isOccluded: boolean;
}>;

/** Reports whether `bounds` describes a non-zero, finite size that can actually be rendered. */
export const hasRenderablePaneBounds = (bounds: PaneLayoutBounds | null | undefined) => {
  if (!bounds) {
    return false;
  }

  return Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0;
};

/** Reports whether a pane is on the active tab, unoccluded, and has renderable bounds. */
export const isPaneVisible = (input: PaneVisibilityInput) => {
  return input.isActiveTab && !input.isOccluded && hasRenderablePaneBounds(input.bounds);
};
