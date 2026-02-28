/** @file Verifies renderer tracking helpers and fallback reason counters. */
import {beforeEach, describe, expect, test} from 'bun:test';
import {createRendererUid} from '@shared/types/common';

import {
  getRendererFallbackReasonCounts,
  getRendererTypes,
  getRendererWebGLContextCounts,
  resetRendererTracking,
  setRendererType,
  unsetRendererType
} from '../../app/utils/renderer-utils';

beforeEach(() => {
  resetRendererTracking();
});

describe('renderer-utils', () => {
  const asRendererUid = (uid: string) => createRendererUid(uid);

  describe('resetRendererTracking', () => {
    test('clears all tracked renderer metrics', () => {
      setRendererType(asRendererUid('uid-1'), 'WebGL');
      setRendererType(asRendererUid('uid-2'), 'Canvas', 'context-loss');
      setRendererType(asRendererUid('uid-3'), 'WebGL');

      expect(getRendererTypes()).toEqual({
        'uid-1': 'WebGL',
        'uid-2': 'Canvas',
        'uid-3': 'WebGL'
      });
      expect(getRendererFallbackReasonCounts()).toEqual({
        'context-loss': 1
      });
      expect(getRendererWebGLContextCounts()).toEqual({
        current: 2,
        peak: 2
      });

      resetRendererTracking();

      expect(getRendererTypes()).toEqual({});
      expect(getRendererFallbackReasonCounts()).toEqual({});
      expect(getRendererWebGLContextCounts()).toEqual({
        current: 0,
        peak: 0
      });
    });

    test('is idempotent when called repeatedly', () => {
      resetRendererTracking();
      expect(() => resetRendererTracking()).not.toThrow();

      expect(getRendererTypes()).toEqual({});
      expect(getRendererFallbackReasonCounts()).toEqual({});
      expect(getRendererWebGLContextCounts()).toEqual({
        current: 0,
        peak: 0
      });
    });
  });

  test('tracks renderer type by uid and records WebGL current/peak context counts', () => {
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-2'), 'Canvas');
    setRendererType(asRendererUid('uid-3'), 'WebGL');
    setRendererType(asRendererUid('uid-1'), 'Canvas');
    unsetRendererType(asRendererUid('uid-3'));

    expect(getRendererTypes()).toEqual({
      'uid-1': 'Canvas',
      'uid-2': 'Canvas'
    });
    expect(getRendererWebGLContextCounts()).toEqual({
      current: 0,
      peak: 2
    });
    expect(getRendererFallbackReasonCounts()).toEqual({});
  });

  test('counts fallback reasons whenever a reason is provided', () => {
    setRendererType(asRendererUid('uid-1'), 'Canvas', 'context-loss');
    setRendererType(asRendererUid('uid-1'), 'Canvas', 'context-loss');
    setRendererType(asRendererUid('uid-2'), 'Canvas', 'pool-evicted');

    expect(getRendererFallbackReasonCounts()).toEqual({
      'context-loss': 2,
      'pool-evicted': 1
    });
  });

  test('does not decrement fallback counters when sessions are unset', () => {
    setRendererType(asRendererUid('uid-1'), 'Canvas', 'webgl-init-failed');
    unsetRendererType(asRendererUid('uid-1'));

    expect(getRendererTypes()).toEqual({});
    expect(getRendererFallbackReasonCounts()).toEqual({
      'webgl-init-failed': 1
    });
  });

  test('only updates WebGL counts when WebGL classification changes', () => {
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-1'), 'Canvas');
    setRendererType(asRendererUid('uid-1'), 'Canvas');

    expect(getRendererWebGLContextCounts()).toEqual({
      current: 0,
      peak: 1
    });
  });

  test('returns WebGL context counts as an immutable snapshot', () => {
    resetRendererTracking();
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-2'), 'WebGL');

    const snapshot = getRendererWebGLContextCounts();
    snapshot.current = 0;
    snapshot.peak = 0;

    expect(getRendererWebGLContextCounts()).toEqual({
      current: 2,
      peak: 2
    });
  });
});
