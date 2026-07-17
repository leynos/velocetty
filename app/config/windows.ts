import type {BrowserWindow} from 'electron';

import Config from 'electron-store';

/** Fallback window position and size used before any state has been persisted. */
export const defaults = {
  /** Default top-left window position, in screen pixels. */
  windowPosition: [50, 50] as [number, number],
  /** Default window size, in pixels. */
  windowSize: [540, 380] as [number, number]
};

// local storage
const cfg = new Config({defaults});

/** Reads the persisted window position and size, falling back to the defaults. */
export function get() {
  const position = cfg.get('windowPosition', defaults.windowPosition);
  const size = cfg.get('windowSize', defaults.windowSize);
  return {
    /** The window's top-left position, in screen pixels. */
    position,
    /** The window's size, in pixels. */
    size
  };
}
/** Persists the given window's current position and size for next launch. */
export function recordState(win: BrowserWindow) {
  cfg.set('windowPosition', win.getPosition());
  cfg.set('windowSize', win.getSize());
}
