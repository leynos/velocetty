/** @file Tracks WebGL context allocations with strict capacity and LRU eviction. */

export type WebGLContextPoolOptions = Readonly<{
  maxContexts: number;
}>;

export type WebGLContextFactory<TContext> = () => TContext;

export type WebGLContextDisposer<TContext> = (context: TContext, paneId: string) => void;

export type WebGLAcquireResult<TContext> = Readonly<{
  context: TContext;
  reused: boolean;
  evictedPaneId: string | null;
  evictedContext: TContext | null;
}>;

type WebGLPoolEntry<TContext> = {
  context: TContext;
  lastVisibleTick: number;
};

const assertValidMaxContexts = (maxContexts: number) => {
  if (!Number.isInteger(maxContexts) || maxContexts < 1) {
    throw new RangeError('WebGLContextPool maxContexts must be an integer greater than 0.');
  }
};

export class WebGLContextPool<TContext> {
  readonly #entries = new Map<string, WebGLPoolEntry<TContext>>();
  readonly #maxContexts: number;
  #nextTick = 0;

  constructor(options: WebGLContextPoolOptions) {
    assertValidMaxContexts(options.maxContexts);
    this.#maxContexts = options.maxContexts;
  }

  get maxContexts() {
    return this.#maxContexts;
  }

  get size() {
    return this.#entries.size;
  }

  has(paneId: string) {
    return this.#entries.has(paneId);
  }

  get(paneId: string) {
    return this.#entries.get(paneId)?.context;
  }

  acquire(
    paneId: string,
    createContext: WebGLContextFactory<TContext>,
    disposeContext?: WebGLContextDisposer<TContext>
  ): WebGLAcquireResult<TContext> {
    const existing = this.#entries.get(paneId);
    if (existing) {
      existing.lastVisibleTick = this.#takeTick();
      return {
        context: existing.context,
        reused: true,
        evictedPaneId: null,
        evictedContext: null
      };
    }

    let evictedPaneId: string | null = null;
    let evictedContext: TContext | null = null;

    if (this.#entries.size >= this.#maxContexts) {
      const leastRecentlyVisiblePaneId = this.#getLeastRecentlyVisiblePaneId();
      if (!leastRecentlyVisiblePaneId) {
        throw new Error('WebGLContextPool failed to identify an eviction candidate at capacity.');
      }

      const evictedEntry = this.#entries.get(leastRecentlyVisiblePaneId);
      if (!evictedEntry) {
        throw new Error('WebGLContextPool failed to load eviction entry at capacity.');
      }

      this.#entries.delete(leastRecentlyVisiblePaneId);
      evictedPaneId = leastRecentlyVisiblePaneId;
      evictedContext = evictedEntry.context;
      disposeContext?.(evictedEntry.context, leastRecentlyVisiblePaneId);
    }

    const context = createContext();
    this.#entries.set(paneId, {
      context,
      lastVisibleTick: this.#takeTick()
    });

    return {
      context,
      reused: false,
      evictedPaneId,
      evictedContext
    };
  }

  release(paneId: string, disposeContext?: WebGLContextDisposer<TContext>) {
    const entry = this.#entries.get(paneId);
    if (!entry) {
      return undefined;
    }

    this.#entries.delete(paneId);
    disposeContext?.(entry.context, paneId);
    return entry.context;
  }

  touch(paneId: string) {
    const entry = this.#entries.get(paneId);
    if (!entry) {
      return false;
    }

    entry.lastVisibleTick = this.#takeTick();
    return true;
  }

  clear(disposeContext?: WebGLContextDisposer<TContext>) {
    if (disposeContext) {
      for (const [paneId, entry] of this.#entries) {
        disposeContext(entry.context, paneId);
      }
    }

    this.#entries.clear();
  }

  #takeTick() {
    this.#nextTick += 1;
    return this.#nextTick;
  }

  #getLeastRecentlyVisiblePaneId() {
    let leastRecentlyVisiblePaneId: string | null = null;
    let leastRecentlyVisibleTick = Number.POSITIVE_INFINITY;

    for (const [paneId, entry] of this.#entries) {
      if (entry.lastVisibleTick < leastRecentlyVisibleTick) {
        leastRecentlyVisiblePaneId = paneId;
        leastRecentlyVisibleTick = entry.lastVisibleTick;
      }
    }

    return leastRecentlyVisiblePaneId;
  }
}
