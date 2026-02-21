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

export const mergeTabDecorations = (decorations: TabDecoration[]): TabDecoration => {
  const merged: TabDecoration = {};
  const badges: TabDecorationBadge[] = [];
  const widgets: TabDecorationWidget[] = [];
  const seenBadgeKeys = new Set<string>();
  const seenWidgetKeys = new Set<string>();

  for (const decoration of decorations) {
    if (!merged.icon && decoration.icon) {
      merged.icon = decoration.icon;
    }
    if (!merged.title && decoration.title) {
      merged.title = decoration.title;
    }
    if (!merged.subtitle && decoration.subtitle) {
      merged.subtitle = decoration.subtitle;
    }

    const badgeList = Array.isArray(decoration.badges) ? decoration.badges : undefined;
    const widgetList = Array.isArray(decoration.widgets) ? decoration.widgets : undefined;

    if (badgeList && badges.length < MAX_BADGES) {
      for (const badge of badgeList) {
        if (badges.length >= MAX_BADGES) {
          break;
        }
        const key = badgeKey(badge);
        if (seenBadgeKeys.has(key)) {
          continue;
        }
        seenBadgeKeys.add(key);
        badges.push(badge);
      }
    }

    if (widgetList && widgets.length < MAX_WIDGETS) {
      for (const widget of widgetList) {
        if (widgets.length >= MAX_WIDGETS) {
          break;
        }
        const key = widgetKey(widget);
        if (seenWidgetKeys.has(key)) {
          continue;
        }
        seenWidgetKeys.add(key);
        widgets.push(widget);
      }
    }
  }

  if (badges.length > 0) {
    merged.badges = badges;
  }

  if (widgets.length > 0) {
    merged.widgets = widgets;
  }

  return merged;
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
      try {
        const dispose = registered.provider.subscribe(() => {
          this.emitChange();
        });

        if (typeof dispose === 'function') {
          registered.disposeChangeListener = dispose;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Tab decoration provider "${registered.provider.id}" subscribe failed: ${reason}`);
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
