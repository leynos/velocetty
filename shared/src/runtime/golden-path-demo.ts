/** @file Golden path demonstration plugin manifest and static contributions. */
import type {CommandDefinition, CommandId} from '../types/commands';

/** Stable plugin identifier used for namespaced settings persistence. */
export const GOLDEN_PATH_PLUGIN_ID = 'velocetty.golden-path-demo';
/** Stable command identifier registered by the golden path plugin. */
export const GOLDEN_PATH_COMMAND_ID = 'plugins:golden-path-demo:announce' as CommandId;
/** Default keybinding shipped by the golden path plugin. */
export const GOLDEN_PATH_KEYBINDING = 'ctrl+alt+shift+g';

/** Settings payload persisted under `config.plugins[pluginId]`. */
export type GoldenPathPluginSettings = {
  /** Whether the plugin's command and keybinding contributions are active. */
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
 * JSON-schema-compatible settings descriptor used by the plugin manifest; a
 * data seam whose nested nodes carry their own `description` semantics.
 *
 * @internal
 */
export const goldenPathSettingsSchema = {
  /** Schema node kind: this describes an object. */
  type: 'object',
  /** Rejects settings payloads carrying keys outside those declared below. */
  additionalProperties: false,
  /** JSON Schema definitions for each settings key. */
  properties: {
    enabled: {
      /** Schema node kind for `enabled`: a boolean flag. */
      type: 'boolean',
      /** Description surfaced to settings UI consumers. */
      description: 'Controls whether runtime command and keybinding contributions are active.'
    },
    message: {
      /** Schema node kind for `message`: a string value. */
      type: 'string',
      /** Minimum permitted string length. */
      minLength: 1,
      /** Description surfaced to settings UI consumers. */
      description: 'Notification text emitted when the plugin command is invoked.'
    },
    tabPrefix: {
      /** Schema node kind for `tabPrefix`: a string value. */
      type: 'string',
      /** Minimum permitted string length. */
      minLength: 1,
      /** Description surfaced to settings UI consumers. */
      description: 'Prefix rendered by the tab decoration provider for each tab title.'
    }
  },
  /** Settings keys that must be present for the schema to validate. */
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
  /** Badge label text, if any. */
  readonly text?: string;
  /** Badge icon identifier, if any. */
  readonly icon?: string;
  /** Tooltip shown on hover, if any. */
  readonly tooltip?: string;
  /** Severity styling applied to the badge. */
  readonly kind?: 'info' | 'warn' | 'error';
};

/** Clickable icon control rendered alongside a tab decoration. */
export type RuntimeTabDecorationWidget = {
  /** Icon identifier rendered for the widget. */
  readonly icon: string;
  /** Command invoked when the widget is activated. */
  readonly command: CommandId;
  /** Tooltip shown on hover, if any. */
  readonly tooltip?: string;
};

/** Decoration a tab decoration provider may apply to a single tab. */
export type RuntimeTabDecoration = {
  /** Replacement tab title, if any. */
  readonly title?: string;
  /** Secondary text shown beneath the tab title, if any. */
  readonly subtitle?: string;
  /** Status badges to render on the tab, if any. */
  readonly badges?: readonly RuntimeTabDecorationBadge[];
  /** Interactive widgets to render on the tab, if any. */
  readonly widgets?: readonly RuntimeTabDecorationWidget[];
};

/** Context passed to runtime tab decoration providers. */
export type RuntimeTabDecorationContext = {
  /** Identifier of the tab being decorated. */
  readonly tabId: string;
  /** Zero-based position of the tab. */
  readonly tabIndex: number;
  /** Whether the tab is currently focused. */
  readonly active: boolean;
  /** Whether the tab has unread activity. */
  readonly hasActivity: boolean;
  /** Current tab title, if set. */
  readonly title?: string;
};

/** Runtime tab decoration provider contribution contract. */
export type RuntimeTabDecorationProvider = {
  /** Unique identifier for the provider. */
  readonly id: string;
  /** Ordering weight; higher values take precedence when providers conflict. */
  readonly priority: number;
  /** Computes the decoration to apply for a given tab, or `null`/`undefined` for none. */
  readonly provideDecoration: (
    context: RuntimeTabDecorationContext,
    settings: Record<string, unknown>
  ) => RuntimeTabDecoration | null | undefined;
};

/** Runtime plugin manifest contract for roadmap 1.3.1 contributions. */
export type RuntimePluginManifest = {
  /** Stable plugin identifier used for namespaced settings persistence. */
  readonly id: string;
  /** Plugin version string. */
  readonly version: string;
  /** Human-readable plugin name shown in the UI. */
  readonly displayName: string;
  /** Human-readable summary of what the plugin does. */
  readonly description: string;
  /** JSON-schema-compatible descriptor for the plugin's settings shape. */
  readonly settingsSchema: Readonly<Record<string, unknown>>;
  /** Default values applied when settings are not otherwise configured. */
  readonly settingsDefaults: Readonly<Record<string, unknown>>;
  /** Commands the plugin registers with the command runtime. */
  readonly commands: readonly CommandDefinition[];
  /** Default keybindings, keyed by command ID. */
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
        const runtimeSettings = settings as {tabPrefix?: unknown};
        const tabPrefix = runtimeSettings.tabPrefix;
        const prefix =
          typeof tabPrefix === 'string' && tabPrefix.trim().length > 0
            ? tabPrefix
            : goldenPathSettingsDefaults.tabPrefix;
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
