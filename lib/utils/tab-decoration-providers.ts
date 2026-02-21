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

export type TabDecorationBadge = {
  text?: string;
  icon?: string;
  tooltip?: string;
  kind?: 'info' | 'warn' | 'error';
};

export type TabDecorationWidget = {
  icon: string;
  command: CommandId;
  tooltip?: string;
};

export type TabDecoration = {
  icon?: {name: string; tooltip?: string};
  title?: string;
  subtitle?: string;
  badges?: TabDecorationBadge[];
  widgets?: TabDecorationWidget[];
};

export type TabDecorationContext = {
  tabId: string;
  tabIndex: number;
  active: boolean;
  hasActivity: boolean;
  title?: string;
};

export type TabDecorationProvider = {
  id: string;
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

const badgeKey = (badge: TabDecorationBadge) =>
  `${badge.icon ?? ''}:${badge.text ?? ''}:${badge.tooltip ?? ''}:${badge.kind ?? ''}`;

const widgetKey = (widget: TabDecorationWidget) => `${widget.icon}:${widget.command}:${widget.tooltip ?? ''}`;

const compareProviders = (a: RegisteredProvider, b: RegisteredProvider) => {
  const byPriority = b.provider.priority - a.provider.priority;
  if (byPriority !== 0) {
    return byPriority;
  }

  const byId = a.provider.id.localeCompare(b.provider.id);
  if (byId !== 0) {
    return byId;
  }

  return a.registrationOrder - b.registrationOrder;
};

type DecorationItemKey<T> = (item: T) => string;

const collectDecorationItems = <T>(
  decorations: TabDecoration[],
  propertyKey: 'badges' | 'widgets',
  itemKey: DecorationItemKey<T>,
  maxItems: number
): T[] => {
  const items: T[] = [];
  const seenKeys = new Set<string>();
  const allItems = decorations.flatMap((decoration) => {
    const decorationItems = decoration[propertyKey];
    return Array.isArray(decorationItems) ? (decorationItems as T[]) : [];
  });

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
  return collectDecorationItems<TabDecorationBadge>(decorations, 'badges', badgeKey, MAX_BADGES);
};

const collectWidgets = (decorations: TabDecoration[]): TabDecorationWidget[] => {
  return collectDecorationItems<TabDecorationWidget>(decorations, 'widgets', widgetKey, MAX_WIDGETS);
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
  return {
    provider: {
      ...provider,
      id: provider.id.trim(),
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

    if (typeof dispose === 'function') {
      registered.disposeChangeListener = dispose;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Tab decoration provider "${registered.provider.id}" subscribe failed: ${reason}`);
  }
};

export class TabDecorationProviderRegistry {
  private providers: RegisteredProvider[] = [];
  private listeners = new Set<() => void>();
  private registrationCount = 0;

  constructor(private readonly logger: RegistryLogger = defaultRegistryLogger) {}

  register(provider: TabDecorationProvider): () => void {
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
      registered.disposeChangeListener?.();
      this.emitChange();
    };
  }

  clear() {
    this.providers.forEach((provider) => provider.disposeChangeListener?.());
    this.providers = [];
    this.emitChange();
  }

  listProviders(): TabDecorationProvider[] {
    return this.providers
      .slice()
      .sort(compareProviders)
      .map((registered) => registered.provider);
  }

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
}

export const tabDecorationProviders = new TabDecorationProviderRegistry();

export const registerTabDecorationProvider = (provider: TabDecorationProvider) => {
  return tabDecorationProviders.register(provider);
};

export const subscribeTabDecorationProviderChanges = (listener: () => void) => {
  return tabDecorationProviders.subscribe(listener);
};

export const resolveTabDecoration = (context: TabDecorationContext) => {
  return tabDecorationProviders.resolve(context);
};
