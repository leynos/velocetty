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
});
