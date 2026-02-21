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
  command: CommandId | string;
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

const MAX_BADGES = 3;
const MAX_WIDGETS = 2;

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

const dedupeBounded = <T>(items: T[], keyFn: (item: T) => string, limit: number): T[] => {
  const result: T[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
};

// Helper to merge a simple optional property (first non-null wins).
const mergeSimpleProperty = <T extends TabDecoration, K extends keyof T>(
  merged: T,
  decoration: TabDecoration,
  key: K
): void => {
  if (!merged[key] && decoration[key]) {
    merged[key] = decoration[key] as T[K];
  }
};

// Helper to collect array items from decorations.
const collectArrayItems = <T>(decorations: TabDecoration[], key: 'badges' | 'widgets'): T[] => {
  const collected: T[] = [];
  for (const decoration of decorations) {
    const items = decoration[key];
    if (items && items.length > 0) {
      collected.push(...(items as T[]));
    }
  }
  return collected;
};

export const mergeTabDecorations = (decorations: TabDecoration[]): TabDecoration => {
  const merged: TabDecoration = {};

  for (const decoration of decorations) {
    mergeSimpleProperty(merged, decoration, 'icon');
    mergeSimpleProperty(merged, decoration, 'title');
    mergeSimpleProperty(merged, decoration, 'subtitle');
  }

  const mergedBadges = collectArrayItems<TabDecorationBadge>(decorations, 'badges');
  if (mergedBadges.length > 0) {
    merged.badges = dedupeBounded(mergedBadges, badgeKey, MAX_BADGES);
  }

  const mergedWidgets = collectArrayItems<TabDecorationWidget>(decorations, 'widgets');
  if (mergedWidgets.length > 0) {
    merged.widgets = dedupeBounded(mergedWidgets, widgetKey, MAX_WIDGETS);
  }

  return merged;
};

export class TabDecorationProviderRegistry {
  private providers: RegisteredProvider[] = [];
  private listeners = new Set<() => void>();
  private registrationCount = 0;

  register(provider: TabDecorationProvider): () => void {
    const normalizedId = provider.id.trim();
    if (!normalizedId) {
      throw new Error('Tab decoration provider id must be non-empty.');
    }

    const normalizedPriority = Number.isFinite(provider.priority) ? provider.priority : 0;
    const registered: RegisteredProvider = {
      provider: {
        ...provider,
        id: normalizedId,
        priority: normalizedPriority
      },
      registrationOrder: this.registrationCount++
    };

    if (registered.provider.subscribe) {
      const dispose = registered.provider.subscribe(() => {
        this.emitChange();
      });

      if (typeof dispose === 'function') {
        registered.disposeChangeListener = dispose;
      }
    }

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
        console.warn(`Tab decoration provider "${provider.id}" failed: ${reason}`);
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
      listener();
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
