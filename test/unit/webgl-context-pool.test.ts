/** @file Verifies strict-capacity WebGL context pooling with LRU eviction. */
import {describe, expect, test} from 'bun:test';

import {WebGLContextPool} from '../../lib/utils/webgl-context-pool';

type MockContext = {
  id: string;
};

const createFactory = () => {
  let sequence = 0;
  return () => {
    sequence += 1;
    return {id: `ctx-${sequence}`} satisfies MockContext;
  };
};

describe('WebGLContextPool', () => {
  const createDisposerTracker = () => {
    const pairs: string[] = [];
    const disposer = (context: MockContext, paneId: string) => {
      pairs.push(`${paneId}:${context.id}`);
    };

    return {pairs, disposer};
  };

  const testReleaseScenario = ({
    setupPanes,
    releasePane,
    expectedResult,
    expectedDisposedPairs,
    expectedRemainingPanes
  }: {
    setupPanes: string[];
    releasePane: string;
    expectedResult: string | undefined;
    expectedDisposedPairs: string[];
    expectedRemainingPanes: string[];
  }) => {
    const pool = new WebGLContextPool<MockContext>({maxContexts: 3});
    const createContext = createFactory();
    const {pairs, disposer} = createDisposerTracker();
    const contextsByPane = new Map<string, MockContext>();

    for (const paneId of setupPanes) {
      const acquired = pool.acquire(paneId, createContext);
      contextsByPane.set(paneId, acquired.context);
    }

    const released = pool.release(releasePane, disposer);

    if (expectedResult) {
      expect(released).toBe(contextsByPane.get(releasePane));
      expect(released?.id).toBe(expectedResult);
    } else {
      expect(released).toBeUndefined();
    }

    expect(pairs).toEqual(expectedDisposedPairs);

    for (const paneId of expectedRemainingPanes) {
      expect(pool.has(paneId)).toBe(true);
    }

    for (const paneId of setupPanes) {
      if (!expectedRemainingPanes.includes(paneId)) {
        expect(pool.has(paneId)).toBe(false);
      }
    }

    expect(pool.size).toBe(expectedRemainingPanes.length);
  };

  test('enforces the configured maximum and evicts the least recently visible pane', () => {
    const pool = new WebGLContextPool<MockContext>({maxContexts: 2});
    const createContext = createFactory();

    const first = pool.acquire('pane-a', createContext);
    pool.acquire('pane-b', createContext);
    pool.touch('pane-a');

    const third = pool.acquire('pane-c', createContext);

    expect(first.reused).toBe(false);
    expect(third.evictedPaneId).toBe('pane-b');
    expect(third.evictedContext?.id).toBe('ctx-2');

    expect(pool.size).toBe(2);
    expect(pool.has('pane-a')).toBe(true);
    expect(pool.has('pane-b')).toBe(false);
    expect(pool.has('pane-c')).toBe(true);
  });

  test('eviction invokes the disposer callback with pane and context details', () => {
    const disposedPairs: string[] = [];
    const pool = new WebGLContextPool<MockContext>({maxContexts: 1});
    const createContext = createFactory();

    const first = pool.acquire('pane-a', createContext);
    pool.acquire('pane-b', createContext, (context, paneId) => {
      disposedPairs.push(`${paneId}:${context.id}`);
    });

    expect(disposedPairs).toEqual([`pane-a:${first.context.id}`]);
  });

  test('reuses an existing pane allocation and does not call the factory twice', () => {
    const pool = new WebGLContextPool<MockContext>({maxContexts: 1});
    let factoryCalls = 0;
    const createContext = () => {
      factoryCalls += 1;
      return {id: 'ctx-1'} satisfies MockContext;
    };

    const first = pool.acquire('pane-a', createContext);
    const second = pool.acquire('pane-a', createContext);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.context).toBe(first.context);
    expect(factoryCalls).toBe(1);
    expect(pool.size).toBe(1);
  });

  test('release removes a pane allocation and executes disposer callback', () => {
    testReleaseScenario({
      setupPanes: ['pane-a'],
      releasePane: 'pane-a',
      expectedResult: 'ctx-1',
      expectedDisposedPairs: ['pane-a:ctx-1'],
      expectedRemainingPanes: []
    });
  });

  test('touch updates recency and returns false for unknown panes', () => {
    const pool = new WebGLContextPool<MockContext>({maxContexts: 2});
    const createContext = createFactory();

    pool.acquire('pane-a', createContext);
    pool.acquire('pane-b', createContext);

    expect(pool.touch('pane-a')).toBe(true);
    expect(pool.touch('pane-missing')).toBe(false);

    const acquired = pool.acquire('pane-c', createContext);

    expect(acquired.evictedPaneId).toBe('pane-b');
    expect(pool.has('pane-a')).toBe(true);
    expect(pool.has('pane-c')).toBe(true);
  });

  test('clear removes all panes, disposes each context, and resets size', () => {
    const disposedPairs: string[] = [];
    const pool = new WebGLContextPool<MockContext>({maxContexts: 3});
    const createContext = createFactory();

    pool.acquire('pane-a', createContext);
    pool.acquire('pane-b', createContext);
    pool.acquire('pane-c', createContext);

    pool.clear((context, paneId) => {
      disposedPairs.push(`${paneId}:${context.id}`);
    });

    expect(pool.size).toBe(0);
    expect(pool.has('pane-a')).toBe(false);
    expect(pool.has('pane-b')).toBe(false);
    expect(pool.has('pane-c')).toBe(false);
    expect(disposedPairs.sort()).toEqual(['pane-a:ctx-1', 'pane-b:ctx-2', 'pane-c:ctx-3']);
  });

  test('release returns undefined for unknown panes without invoking disposer', () => {
    testReleaseScenario({
      setupPanes: ['pane-known'],
      releasePane: 'pane-missing',
      expectedResult: undefined,
      expectedDisposedPairs: [],
      expectedRemainingPanes: ['pane-known']
    });
  });

  test('rejects invalid maximum context values', () => {
    expect(() => new WebGLContextPool<MockContext>({maxContexts: 0})).toThrow(RangeError);
    expect(() => new WebGLContextPool<MockContext>({maxContexts: -1})).toThrow(RangeError);
    expect(() => new WebGLContextPool<MockContext>({maxContexts: 1.5})).toThrow(RangeError);
  });
});
