/** @file Verifies renderer tracking helpers and fallback reason counters. */
import {beforeEach, describe, expect, test} from 'bun:test';

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
  describe('resetRendererTracking', () => {
    test('clears all tracked renderer metrics', () => {
      setRendererType('uid-1', 'WebGL');
      setRendererType('uid-2', 'Canvas', 'context-loss');
      setRendererType('uid-3', 'WebGL');

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
    setRendererType('uid-1', 'WebGL');
    setRendererType('uid-2', 'Canvas');
    setRendererType('uid-3', 'WebGL');
    setRendererType('uid-1', 'Canvas');
    unsetRendererType('uid-3');

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
    setRendererType('uid-1', 'Canvas', 'context-loss');
    setRendererType('uid-1', 'Canvas', 'context-loss');
    setRendererType('uid-2', 'Canvas', 'pool-evicted');

    expect(getRendererFallbackReasonCounts()).toEqual({
      'context-loss': 2,
      'pool-evicted': 1
    });
  });

  test('does not decrement fallback counters when sessions are unset', () => {
    setRendererType('uid-1', 'Canvas', 'webgl-init-failed');
    unsetRendererType('uid-1');

    expect(getRendererTypes()).toEqual({});
    expect(getRendererFallbackReasonCounts()).toEqual({
      'webgl-init-failed': 1
    });
  });

  test('only updates WebGL counts when WebGL classification changes', () => {
    setRendererType('uid-1', 'WebGL');
    setRendererType('uid-1', 'WebGL');
    setRendererType('uid-1', 'Canvas');
    setRendererType('uid-1', 'Canvas');

    expect(getRendererWebGLContextCounts()).toEqual({
      current: 0,
      peak: 1
    });
  });
});
