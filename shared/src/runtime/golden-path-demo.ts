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
  enabled: boolean;
  message: string;
  tabPrefix: string;
};

/** Default settings for the golden path demonstration plugin. */
export const goldenPathSettingsDefaults: GoldenPathPluginSettings = {
  enabled: true,
  message: 'Golden path plugin command invoked.',
  tabPrefix: 'GP'
};

/** JSON-schema-compatible settings descriptor used by the plugin manifest. */
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
export type RuntimeTabDecoration = {
  title?: string;
  subtitle?: string;
  badges?: Array<{text?: string; icon?: string; tooltip?: string; kind?: 'info' | 'warn' | 'error'}>;
  widgets?: Array<{icon: string; command: CommandId | string; tooltip?: string}>;
};

/** Context passed to runtime tab decoration providers. */
export type RuntimeTabDecorationContext = {
  tabId: string;
  tabIndex: number;
  active: boolean;
  hasActivity: boolean;
  title?: string;
};

/** Runtime tab decoration provider contribution contract. */
export type RuntimeTabDecorationProvider = {
  id: string;
  priority: number;
  provideDecoration: (
    context: RuntimeTabDecorationContext,
    settings: Record<string, unknown>
  ) => RuntimeTabDecoration | null | undefined;
};

/** Runtime plugin manifest contract for roadmap 1.3.1 contributions. */
export type RuntimePluginManifest = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  settingsSchema: Record<string, unknown>;
  settingsDefaults: Record<string, unknown>;
  commands: CommandDefinition[];
  keybindings: Record<string, string[]>;
  tabDecorationProviders: RuntimeTabDecorationProvider[];
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
export const runtimePluginManifests: RuntimePluginManifest[] = [goldenPathPluginManifest];
