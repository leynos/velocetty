/**
 * @file Deterministic tab-decoration provider registry for renderer plugins.
 *
 * Responsibilities:
 * - Register and unregister tab-decoration providers with stable ordering.
 * - Merge provider output deterministically with bounded list slots.
 * - Emit change notifications from explicit provider events (no polling).
 *
 * Usage:
 * - Renderer plugin loader registers providers discovered per plugin module.
 * - Tab rendering subscribes to change notifications and re-renders on demand.
 */

import type {CommandId} from '@shared/types/commands';
import {isFunction, isNumber, isObject, isString} from '@shared/types/guards';

declare const tabIdBrand: unique symbol;
declare const tabDecorationProviderIdBrand: unique symbol;

/** Branded identifier for tab-decoration context targets. */
export type TabId = string & {[tabIdBrand]: 'TabId'};
/** Branded identifier for tab-decoration providers. */
export type TabDecorationProviderId = string & {[tabDecorationProviderIdBrand]: 'TabDecorationProviderId'};

/** Brands a tab identifier without changing its runtime string value. */
// SAFETY: Tab identifiers remain strings at runtime; this constructor centralizes the provider API brand.
export const asTabId = (value: string): TabId => value as TabId;
/** Brands a provider identifier without changing its runtime string value. */
// SAFETY: Provider IDs remain strings at runtime; this constructor centralizes the provider API brand.
export const asTabDecorationProviderId = (value: string): TabDecorationProviderId => value as TabDecorationProviderId;

/** Badge contribution shown alongside a tab label. */
export type TabDecorationBadge = {
  text?: string;
  icon?: string;
  tooltip?: string;
  kind?: 'info' | 'warn' | 'error';
};

/** Actionable widget contribution shown on a tab. */
export type TabDecorationWidget = {
  icon: string;
  command: CommandId;
  tooltip?: string;
};

/** Combined decoration output for a single tab. */
export type TabDecoration = {
  icon?: {name: string; tooltip?: string};
  title?: string;
  subtitle?: string;
  badges?: TabDecorationBadge[];
  widgets?: TabDecorationWidget[];
};

/** Runtime context passed to tab-decoration providers. */
export type TabDecorationContext = {
  tabId: TabId;
  tabIndex: number;
  active: boolean;
  hasActivity: boolean;
  title?: string;
};

/** Contract for tab-decoration providers registered by plugins. */
export type TabDecorationProvider = {
  id: TabDecorationProviderId;
  priority: number;
  provideDecoration: (context: TabDecorationContext) => TabDecoration | null | undefined;
  subscribe?: (onDidChange: () => void) => undefined | (() => void);
};

type RegisteredProvider = {
  provider: TabDecorationProvider;
  registrationOrder: number;
  disposeChangeListener?: () => void;
};

type RegistryLogger = {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

const MAX_BADGES = 3;
const MAX_WIDGETS = 2;
const defaultRegistryLogger: RegistryLogger = {
  warn: (message) => console.warn(message),
  error: (message, error) => console.error(message, error)
};

const isTabDecorationProvider = (candidate: unknown): candidate is TabDecorationProvider => {
  if (
    !isObject(candidate) ||
    !('id' in candidate) ||
    !('priority' in candidate) ||
    !('provideDecoration' in candidate)
  ) {
    return false;
  }

  return (
    isString(candidate.id) &&
    isNumber(candidate.priority) &&
    isFunction(candidate.provideDecoration) &&
    (!('subscribe' in candidate) || candidate.subscribe === undefined || isFunction(candidate.subscribe))
  );
};

const badgeKey = (badge: TabDecorationBadge) =>
  JSON.stringify([badge.icon ?? null, badge.text ?? null, badge.tooltip ?? null, badge.kind ?? null]);

const widgetKey = (widget: TabDecorationWidget) =>
  JSON.stringify([widget.icon, widget.command, widget.tooltip ?? null]);

const compareProviders = (a: RegisteredProvider, b: RegisteredProvider) => {
  const byPriority = b.provider.priority - a.provider.priority;
  if (byPriority !== 0) {
    return byPriority;
  }

  const byId = a.provider.id.localeCompare(b.provider.id, 'en-US');
  if (byId !== 0) {
    return byId;
  }

  return a.registrationOrder - b.registrationOrder;
};

type DecorationItemKey<T> = (item: T) => string;
type DecorationCollectionOptions<T> = {
  itemKey: DecorationItemKey<T>;
  maxItems: number;
};

const collectDecorationItems = <T>(collections: T[][], options: DecorationCollectionOptions<T>): T[] => {
  const {itemKey, maxItems} = options;
  const items: T[] = [];
  const seenKeys = new Set<string>();
  const allItems = collections.flat();

  for (const item of allItems) {
    if (items.length >= maxItems) {
      break;
    }

    const key = itemKey(item);
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    items.push(item);
  }

  return items;
};

const collectBadges = (decorations: TabDecoration[]): TabDecorationBadge[] => {
  return collectDecorationItems(
    decorations.map(({badges}) => badges ?? []),
    {
      itemKey: badgeKey,
      maxItems: MAX_BADGES
    }
  );
};

const collectWidgets = (decorations: TabDecoration[]): TabDecorationWidget[] => {
  return collectDecorationItems(
    decorations.map(({widgets}) => widgets ?? []),
    {
      itemKey: widgetKey,
      maxItems: MAX_WIDGETS
    }
  );
};

const mergeSimpleProperty = <K extends 'icon' | 'title' | 'subtitle'>(
  merged: TabDecoration,
  decoration: TabDecoration,
  key: K
): void => {
  if (!merged[key] && decoration[key]) {
    merged[key] = decoration[key];
  }
};

/** Merge provider outputs into a deterministic single tab-decoration object. */
export const mergeTabDecorations = (decorations: TabDecoration[]): TabDecoration => {
  const merged: TabDecoration = {};

  for (const decoration of decorations) {
    mergeSimpleProperty(merged, decoration, 'icon');
    mergeSimpleProperty(merged, decoration, 'title');
    mergeSimpleProperty(merged, decoration, 'subtitle');
  }

  const badges = collectBadges(decorations);
  const widgets = collectWidgets(decorations);

  if (badges.length > 0) {
    merged.badges = badges;
  }

  if (widgets.length > 0) {
    merged.widgets = widgets;
  }

  return merged;
};

const normalizeProvider = (provider: TabDecorationProvider, registrationOrder: number): RegisteredProvider => {
  const normalizedPriority = Number.isFinite(provider.priority) ? provider.priority : 0;
  const normalizedId = asTabDecorationProviderId(provider.id.trim());
  return {
    provider: {
      ...provider,
      id: normalizedId,
      priority: normalizedPriority
    },
    registrationOrder
  };
};

const setupProviderSubscription = (
  registered: RegisteredProvider,
  onDidChange: () => void,
  logger: RegistryLogger
): void => {
  if (!registered.provider.subscribe) {
    return;
  }

  try {
    const dispose = registered.provider.subscribe(() => {
      onDidChange();
    });

    if (isFunction(dispose)) {
      registered.disposeChangeListener = dispose;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Tab decoration provider "${registered.provider.id}" subscribe failed: ${reason}`);
  }
};

/** In-memory registry for ordered provider resolution and change notifications. */
export class TabDecorationProviderRegistry {
  private providers: RegisteredProvider[] = [];
  private listeners = new Set<() => void>();
  private registrationCount = 0;

  constructor(private readonly logger: RegistryLogger = defaultRegistryLogger) {}

  /**
   * Register a provider and return an unregister callback.
   *
   * Invalid provider identifiers are ignored to prevent plugin errors from
   * breaking renderer decoration updates.
   */
  register(provider: TabDecorationProvider): () => void;
  register(provider: unknown): () => void;
  register(provider: unknown): () => void {
    if (!isTabDecorationProvider(provider)) {
      this.logger.warn('Ignoring invalid tab decoration provider registration.');
      return () => {};
    }

    const normalizedId = provider.id.trim();
    if (!normalizedId) {
      this.logger.warn('Ignoring tab decoration provider registration with empty id.');
      return () => {};
    }

    const registered = normalizeProvider(provider, this.registrationCount++);
    setupProviderSubscription(registered, () => this.emitChange(), this.logger);

    this.providers.push(registered);
    this.emitChange();

    return () => {
      this.providers = this.providers.filter((candidate) => candidate !== registered);
      this.disposeProviderChangeListener(registered);
      this.emitChange();
    };
  }

  /** Remove all registered providers and detach their subscriptions. */
  clear() {
    this.providers.forEach((provider) => this.disposeProviderChangeListener(provider));
    this.providers = [];
    this.emitChange();
  }

  /** Return providers sorted by deterministic priority and id ordering. */
  listProviders(): TabDecorationProvider[] {
    return [...this.providers].toSorted(compareProviders).map((registered) => registered.provider);
  }

  /** Resolve the final merged decoration for the provided tab context. */
  resolve(context: TabDecorationContext): TabDecoration {
    const resolvedDecorations: TabDecoration[] = [];

    for (const provider of this.listProviders()) {
      try {
        const decoration = provider.provideDecoration(context);
        if (decoration) {
          resolvedDecorations.push(decoration);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Tab decoration provider "${provider.id}" failed: ${reason}`);
      }
    }

    return mergeTabDecorations(resolvedDecorations);
  }

  /** Subscribe to provider registry changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        this.logger.error('Tab decoration listener failed during update notification.', error);
      }
    });
  }

  private disposeProviderChangeListener(registered: RegisteredProvider) {
    if (!registered.disposeChangeListener) {
      return;
    }

    try {
      registered.disposeChangeListener();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tab decoration provider "${registered.provider.id}" dispose failed: ${reason}`);
    } finally {
      registered.disposeChangeListener = undefined;
    }
  }
}

/** Singleton registry used by renderer tab-decoration wiring. */
export const tabDecorationProviders = new TabDecorationProviderRegistry();

/** Register a global tab-decoration provider. */
export const registerTabDecorationProvider = (provider: TabDecorationProvider) => {
  return tabDecorationProviders.register(provider);
};

/** Subscribe to tab-decoration provider change events. */
export const subscribeTabDecorationProviderChanges = (listener: () => void) => {
  return tabDecorationProviders.subscribe(listener);
};

/** Resolve the merged decoration for a tab context. */
export const resolveTabDecoration = (context: TabDecorationContext) => {
  return tabDecorationProviders.resolve(context);
};
