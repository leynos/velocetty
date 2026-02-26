/** @file Verifies renderer tracking helpers and fallback reason counters. */
import {beforeEach, describe, expect, test} from 'bun:test';

import {
  getRendererFallbackReasonCounts,
  getRendererTypes,
  setRendererType,
  unsetRendererType
} from '../../app/utils/renderer-utils';

const clearRecord = (record: Record<string, unknown>) => {
  for (const key of Object.keys(record)) {
    delete record[key];
  }
};

beforeEach(() => {
  clearRecord(getRendererTypes());
  clearRecord(getRendererFallbackReasonCounts());
});

describe('renderer-utils', () => {
  test('tracks renderer type by uid', () => {
    setRendererType('uid-1', 'WebGL');

    expect(getRendererTypes()).toEqual({
      'uid-1': 'WebGL'
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
