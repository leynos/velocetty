/** @file Helpers for header window-control ordering and interaction handling. */

/**
 * Reorders window controls so left-aligned layouts match visual and DOM order.
 *
 * @example
 * ```ts
 * orderWindowControlButtons(['minimise', 'maximise', 'close'], true);
 * // ['close', 'minimise', 'maximise']
 * ```
 */
export const orderWindowControlButtons = <T>(buttons: readonly [T, T, T], leftAligned: boolean): [T, T, T] =>
  leftAligned ? [buttons[2], buttons[0], buttons[1]] : [...buttons];

/**
 * Stops button double-clicks bubbling to the draggable title bar.
 *
 * @example
 * ```ts
 * let stopped = false;
 * stopDoubleClickPropagation({stopPropagation: () => {
 *   stopped = true;
 * }});
 * // stopped === true
 * ```
 */
export const stopDoubleClickPropagation = (event: {stopPropagation: () => void}) => {
  event.stopPropagation();
};
