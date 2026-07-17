/** @file Tracks WebGL context allocations with strict capacity and LRU eviction. */

/** Configuration for a {@link WebGLContextPool}. */
export type WebGLContextPoolOptions = Readonly<{
  /** Maximum number of contexts the pool retains before evicting the least recently visible one. */
  maxContexts: number;
}>;

/** Creates a new WebGL context for a pool entry. */
export type WebGLContextFactory<TContext> = () => TContext;

/** Disposes of a WebGL context evicted or released from a pool. */
export type WebGLContextDisposer<TContext> = (context: TContext, paneId: string) => void;

/** Outcome of acquiring a context from a {@link WebGLContextPool}. */
export type WebGLAcquireResult<TContext> = Readonly<{
  /** The acquired (new or reused) context. */
  context: TContext;
  /** Whether an existing context for the pane was reused rather than created. */
  reused: boolean;
  /** Pane id evicted to make room, if any. */
  evictedPaneId: string | null;
  /** Context evicted to make room, if any. */
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

/** Fixed-capacity pool of WebGL contexts keyed by pane id, evicting the least recently visible pane. */
export class WebGLContextPool<TContext> {
  readonly #entries = new Map<string, WebGLPoolEntry<TContext>>();
  readonly #maxContexts: number;
  #nextTick = 0;

  constructor(options: WebGLContextPoolOptions) {
    assertValidMaxContexts(options.maxContexts);
    this.#maxContexts = options.maxContexts;
  }

  /** The pool's configured maximum context capacity. */
  get maxContexts() {
    return this.#maxContexts;
  }

  /** The number of contexts currently held by the pool. */
  get size() {
    return this.#entries.size;
  }

  /** Reports whether the pool currently holds a context for `paneId`. */
  has(paneId: string) {
    return this.#entries.has(paneId);
  }

  /** Returns the context held for `paneId`, if any, without affecting its recency. */
  get(paneId: string) {
    return this.#entries.get(paneId)?.context;
  }

  /** Returns the pane's context, or creates one, evicting the least recently visible pane if at capacity. */
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

  /** Removes and returns the pane's context, disposing it via `disposeContext` if given. */
  release(paneId: string, disposeContext?: WebGLContextDisposer<TContext>) {
    const entry = this.#entries.get(paneId);
    if (!entry) {
      return undefined;
    }

    this.#entries.delete(paneId);
    disposeContext?.(entry.context, paneId);
    return entry.context;
  }

  /** Marks the pane's context as recently visible; reports whether an entry existed to touch. */
  touch(paneId: string) {
    const entry = this.#entries.get(paneId);
    if (!entry) {
      return false;
    }

    entry.lastVisibleTick = this.#takeTick();
    return true;
  }

  /** Removes all held contexts, disposing each via `disposeContext` if given. */
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
