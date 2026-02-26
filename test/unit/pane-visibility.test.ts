/** @file Verifies pane visibility decisions using pure layout and state signals. */
import {describe, expect, test} from 'bun:test';

import {hasRenderablePaneBounds, isPaneVisible} from '../../lib/utils/pane-visibility';

describe('pane visibility helper', () => {
  test('returns true when pane is on the active tab, not occluded, and has non-zero bounds', () => {
    expect(
      isPaneVisible({
        isActiveTab: true,
        isOccluded: false,
        bounds: {width: 640, height: 360}
      })
    ).toBe(true);
  });

  test('returns false when pane tab is inactive', () => {
    expect(
      isPaneVisible({
        isActiveTab: false,
        isOccluded: false,
        bounds: {width: 640, height: 360}
      })
    ).toBe(false);
  });

  test('returns false when pane is occluded', () => {
    expect(
      isPaneVisible({
        isActiveTab: true,
        isOccluded: true,
        bounds: {width: 640, height: 360}
      })
    ).toBe(false);
  });

  test('returns false when pane bounds are zero or missing', () => {
    expect(
      isPaneVisible({
        isActiveTab: true,
        isOccluded: false,
        bounds: {width: 0, height: 360}
      })
    ).toBe(false);

    expect(
      isPaneVisible({
        isActiveTab: true,
        isOccluded: false,
        bounds: {width: 640, height: 0}
      })
    ).toBe(false);

    expect(
      isPaneVisible({
        isActiveTab: true,
        isOccluded: false,
        bounds: null
      })
    ).toBe(false);
  });

  test('bounds helper accepts only finite positive width and height', () => {
    expect(hasRenderablePaneBounds({width: 1, height: 1})).toBe(true);
    expect(hasRenderablePaneBounds({width: 0, height: 1})).toBe(false);
    expect(hasRenderablePaneBounds({width: 1, height: 0})).toBe(false);
    expect(hasRenderablePaneBounds({width: -1, height: 1})).toBe(false);
    expect(hasRenderablePaneBounds({width: 1, height: -1})).toBe(false);
    expect(hasRenderablePaneBounds({width: Number.NaN, height: 1})).toBe(false);
    expect(hasRenderablePaneBounds({width: 1, height: Number.POSITIVE_INFINITY})).toBe(false);
    expect(hasRenderablePaneBounds(undefined)).toBe(false);
  });
});
