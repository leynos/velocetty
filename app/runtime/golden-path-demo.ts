/** @file App-runtime golden path plugin manifest and static contributions. */
import type {CommandDefinition, CommandId} from '@shared/types/commands';

/** Stable plugin identifier used for namespaced settings persistence. */
export const GOLDEN_PATH_PLUGIN_ID = 'velocetty.golden-path-demo';
/** Stable command identifier registered by the golden path plugin. */
export const GOLDEN_PATH_COMMAND_ID = 'plugins:golden-path-demo:announce' as CommandId;
/** Default keybinding shipped by the golden path plugin. */
export const GOLDEN_PATH_KEYBINDING = 'ctrl+alt+shift+g';

/** Settings payload persisted under `config.plugins[pluginId]`. */
export type GoldenPathPluginSettings = {
  /** Whether runtime command and keybinding contributions are active. */
  readonly enabled: boolean;
  /** Notification text emitted when the plugin command is invoked. */
  readonly message: string;
  /** Prefix rendered by the tab decoration provider for each tab title. */
  readonly tabPrefix: string;
};

/** Default settings for the golden path demonstration plugin. */
export const goldenPathSettingsDefaults: GoldenPathPluginSettings = {
  enabled: true,
  message: 'Golden path plugin command invoked.',
  tabPrefix: 'GP'
};

/**
 * JSON-schema-compatible settings descriptor used by the plugin manifest.
 *
 * @internal
 */
export const goldenPathSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: {
      type: 'boolean',
      description: 'Controls whether runtime command and keybinding contributions are active.'
    },
    message: {
      type: 'string',
      minLength: 1,
      description: 'Notification text emitted when the plugin command is invoked.'
    },
    tabPrefix: {
      type: 'string',
      minLength: 1,
      description: 'Prefix rendered by the tab decoration provider for each tab title.'
    }
  },
  required: ['enabled', 'message', 'tabPrefix']
} as const;

/** Command registered by the golden path plugin when enabled. */
export const goldenPathCommandDefinition: CommandDefinition = {
  id: GOLDEN_PATH_COMMAND_ID,
  kind: 'frontend',
  metadata: {
    title: 'Golden Path: Announce',
    category: 'Plugins',
    description: 'Demonstration command registered through the plugin runtime.',
    keywords: ['plugin', 'golden-path', 'demo']
  }
};

/** Shared tab decoration shape returned by runtime plugin providers. */
export type RuntimeTabDecorationBadge = {
  /** Short badge text shown alongside the tab title. */
  readonly text?: string;
  /** Icon identifier rendered for the badge. */
  readonly icon?: string;
  /** Tooltip text shown on hover. */
  readonly tooltip?: string;
  /** Visual severity used to style the badge. */
  readonly kind?: 'info' | 'warn' | 'error';
};

/** An actionable icon rendered on a tab, invoking a command when clicked. */
export type RuntimeTabDecorationWidget = {
  /** Icon identifier rendered for the widget. */
  readonly icon: string;
  /** Command invoked when the widget is activated. */
  readonly command: CommandId;
  /** Tooltip text shown on hover. */
  readonly tooltip?: string;
};

/** Decoration applied to a single tab by a {@link RuntimeTabDecorationProvider}. */
export type RuntimeTabDecoration = {
  /** Replacement title for the tab, when provided. */
  readonly title?: string;
  /** Secondary text shown beneath the tab title, when provided. */
  readonly subtitle?: string;
  /** Status badges rendered on the tab. */
  readonly badges?: readonly RuntimeTabDecorationBadge[];
  /** Actionable widgets rendered on the tab. */
  readonly widgets?: readonly RuntimeTabDecorationWidget[];
};

/** Context passed to runtime tab decoration providers. */
export type RuntimeTabDecorationContext = {
  /** Stable identifier of the tab being decorated. */
  readonly tabId: string;
  /** Zero-based position of the tab within its window. */
  readonly tabIndex: number;
  /** Whether this tab is the currently focused tab. */
  readonly active: boolean;
  /** Whether the tab's shell has produced output since it was last viewed. */
  readonly hasActivity: boolean;
  /** The tab's current title, when set. */
  readonly title?: string;
};

/** Runtime tab decoration provider contribution contract. */
export type RuntimeTabDecorationProvider = {
  /** Stable identifier used to order and deduplicate providers. */
  readonly id: string;
  /** Higher-priority providers are applied first when decorations conflict. */
  readonly priority: number;
  /** Computes a tab's decoration, or returns nothing to leave it undecorated. */
  readonly provideDecoration: (
    context: RuntimeTabDecorationContext,
    settings: Record<string, unknown>
  ) => RuntimeTabDecoration | null | undefined;
};

/** Runtime plugin manifest contract for roadmap 1.3.1 contributions. */
export type RuntimePluginManifest = {
  /** Stable, namespaced plugin identifier. */
  readonly id: string;
  /** Plugin version string. */
  readonly version: string;
  /** Human-readable plugin name shown in the UI. */
  readonly displayName: string;
  /** Human-readable description of what the plugin does. */
  readonly description: string;
  /** JSON-schema-compatible descriptor for the plugin's settings. */
  readonly settingsSchema: Readonly<Record<string, unknown>>;
  /** Default values for the plugin's settings. */
  readonly settingsDefaults: Readonly<Record<string, unknown>>;
  /** Commands the plugin registers with the runtime. */
  readonly commands: readonly CommandDefinition[];
  /** Default keybindings for the plugin's commands, keyed by command id. */
  readonly keybindings: Readonly<Record<string, readonly string[]>>;
  /** Tab decoration providers the plugin contributes. */
  readonly tabDecorationProviders: readonly RuntimeTabDecorationProvider[];
};

/** Manifest for the built-in golden path demonstration plugin. */
export const goldenPathPluginManifest: RuntimePluginManifest = {
  id: GOLDEN_PATH_PLUGIN_ID,
  version: '1.0.0',
  displayName: 'Golden Path Demonstration Plugin',
  description: 'Built-in runtime plugin that demonstrates manifest, settings, command, and keybinding flow.',
  settingsSchema: goldenPathSettingsSchema as Record<string, unknown>,
  settingsDefaults: {...goldenPathSettingsDefaults},
  commands: [{...goldenPathCommandDefinition}],
  keybindings: {
    [GOLDEN_PATH_COMMAND_ID]: [GOLDEN_PATH_KEYBINDING]
  },
  tabDecorationProviders: [
    {
      id: 'title-prefix',
      priority: 100,
      provideDecoration: (context, settings) => {
        const prefix =
          typeof settings.tabPrefix === 'string' && settings.tabPrefix.trim().length > 0 ? settings.tabPrefix : 'GP';
        const baseTitle = typeof context.title === 'string' && context.title.length > 0 ? context.title : 'Shell';
        const activitySuffix = context.hasActivity ? '!' : '';
        return {
          title: `[${prefix}${activitySuffix}] ${baseTitle}`
        };
      }
    }
  ]
};

/** Deterministic list of runtime manifests loaded by the plugin runtime. */
export const runtimePluginManifests: readonly RuntimePluginManifest[] = [goldenPathPluginManifest];
