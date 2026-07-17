/** @file Zod schema registry for IPC command response validation.
 *
 * Each schema mirrors the return type of the corresponding `IpcCommands`
 * entry in `shared/src/types/common.ts`. Object schemas use `.passthrough()`
 * because plugins can decorate the config with extra fields at runtime.
 */
import {z} from 'zod';

import type {ZodType} from 'zod';
import type {FontWeight} from 'xterm';
import type {IpcCommands} from '@shared/types/common';

// ---------------------------------------------------------------------------
// Composable sub-schemas
// ---------------------------------------------------------------------------

/** Uint8Array or string — child-process stdio union.
 *
 * Uses Uint8Array rather than Buffer because IPC serialization (structured
 * clone) converts Buffer instances to Uint8Array.  Since Buffer extends
 * Uint8Array, this also accepts Buffer values in the main process.
 */
const stdioValueSchema = z.union([z.string(), z.instanceof(Uint8Array)]);

const childProcessResultSchema = z.object({
  /** Captured standard output from the spawned process. */
  stdout: stdioValueSchema,
  /** Captured standard error from the spawned process. */
  stderr: stdioValueSchema
});

/** xterm FontWeight: named weights, CSS numeric strings, or raw numbers. */
const fontWeightSchema: ZodType<FontWeight> = z.union([
  z.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']),
  z.number()
]);

/** Terminal colour palette. */
const colorMapSchema = z
  .object({
    /** ANSI black, used for both the palette entry and cursor contrast. */
    black: z.string(),
    /** ANSI blue. */
    blue: z.string(),
    /** ANSI cyan. */
    cyan: z.string(),
    /** ANSI green. */
    green: z.string(),
    /** Bright variant of ANSI black, used for high-intensity escape codes. */
    lightBlack: z.string(),
    /** Bright variant of ANSI blue. */
    lightBlue: z.string(),
    /** Bright variant of ANSI cyan. */
    lightCyan: z.string(),
    /** Bright variant of ANSI green. */
    lightGreen: z.string(),
    /** Bright variant of ANSI magenta. */
    lightMagenta: z.string(),
    /** Bright variant of ANSI red. */
    lightRed: z.string(),
    /** Bright variant of ANSI white. */
    lightWhite: z.string(),
    /** Bright variant of ANSI yellow. */
    lightYellow: z.string(),
    /** ANSI magenta. */
    magenta: z.string(),
    /** ANSI red. */
    red: z.string(),
    /** ANSI white. */
    white: z.string(),
    /** ANSI yellow. */
    yellow: z.string()
  })
  .passthrough();

/** Profile-level configuration fields. */
const profileConfigSchema = z
  .object({
    /** Terminal background colour. */
    backgroundColor: z.string(),
    /** Whether the bell plays a sound or is disabled entirely. */
    bell: z.union([z.literal('SOUND'), z.literal(false)]),
    /** Path to a custom bell sound file, or null to use the built-in sound. */
    bellSound: z.string().nullable(),
    /** URL of a custom bell sound, resolved from `bellSound` at load time. */
    bellSoundURL: z.string().nullable(),
    /** Colour of the window border/frame. */
    borderColor: z.string(),
    /** ANSI colour palette used to render terminal escape sequences. */
    colors: colorMapSchema,
    /** Whether selecting text also copies it to the clipboard. */
    copyOnSelect: z.boolean(),
    /** Raw CSS injected into the terminal window for user styling. */
    css: z.string(),
    /** Accent colour drawn around the cursor. */
    cursorAccentColor: z.string(),
    /** Whether the cursor blinks while idle. */
    cursorBlink: z.boolean(),
    /** Cursor fill/outline colour. */
    cursorColor: z.string(),
    /** Visual style used to render the cursor. */
    cursorShape: z.enum([
      /** Thin vertical bar cursor. */
      'BEAM',
      /** Underline cursor. */
      'UNDERLINE',
      /** Solid block cursor. */
      'BLOCK'
    ]),
    /** Whether font ligatures are disabled. */
    disableLigatures: z.boolean(),
    /** Extra environment variables merged into the shell's environment. */
    env: z.record(z.string(), z.string()),
    /** Terminal font family. */
    fontFamily: z.string(),
    /** Terminal font size, in pixels. */
    fontSize: z.number(),
    /** Font weight used for normal-intensity text. */
    fontWeight: fontWeightSchema,
    /** Font weight used for bold-intensity text. */
    fontWeightBold: fontWeightSchema,
    /** Terminal foreground (text) colour. */
    foregroundColor: z.string(),
    /** Whether inline image rendering (e.g. sixel) is enabled. */
    imageSupport: z.boolean(),
    /** Extra spacing added between characters, in pixels. */
    letterSpacing: z.number(),
    /** Line height multiplier applied to terminal rows. */
    lineHeight: z.number(),
    /** Platform-specific behaviour for Option-key text selection on macOS. */
    macOptionSelectionMode: z.string(),
    /** Overrides for how modifier keys are interpreted by the terminal. */
    modifierKeys: z
      .object({
        /** Whether Alt is treated as the Meta key. */
        altIsMeta: z.boolean(),
        /** Whether Cmd is treated as the Meta key. */
        cmdIsMeta: z.boolean()
      })
      .optional(),
    /** CSS padding applied around the terminal content area. */
    padding: z.string(),
    /** Whether new tabs/splits inherit the current working directory. */
    preserveCWD: z.boolean(),
    /** Whether quick-edit (right-click paste) mode is enabled. */
    quickEdit: z.boolean(),
    /** Whether accessibility support for screen readers is enabled. */
    screenReaderMode: z.boolean(),
    /** Number of lines retained in the terminal's scrollback buffer. */
    scrollback: z.number(),
    /** Colour used to highlight selected text. */
    selectionColor: z.string(),
    /** Path to the shell executable launched for new sessions. */
    shell: z.string(),
    /** Arguments passed to the shell executable on launch. */
    shellArgs: z.array(z.string()),
    /** Whether the hamburger menu is shown, and where. */
    showHamburgerMenu: z.union([z.boolean(), z.literal('')]),
    /** Whether native window controls are shown, and on which side. */
    showWindowControls: z.union([z.boolean(), z.literal('left'), z.literal('')]),
    /** Raw CSS injected specifically into the xterm.js term element. */
    termCSS: z.string(),
    /** Font family used for Hyper's own UI chrome, distinct from the terminal font. */
    uiFontFamily: z.string().optional(),
    /** Whether the WebGL renderer is used instead of the canvas renderer. */
    webGLRenderer: z.boolean(),
    /** Modifier key that must be held to activate clickable web links. */
    webLinksActivationKey: z.enum([
      /** Require the Ctrl key. */
      'ctrl',
      /** Require the Alt key. */
      'alt',
      /** Require the Meta (Cmd/Win) key. */
      'meta',
      /** Require the Shift key. */
      'shift',
      /** No modifier required; links activate on plain click. */
      ''
    ]),
    /** Initial terminal window size, as [columns, rows]. */
    windowSize: z.tuple([z.number(), z.number()]).optional(),
    /** Initial working directory for new sessions. */
    workingDirectory: z.string()
  })
  .passthrough();

/** Root-level configuration fields. */
const rootConfigSchema = z
  .object({
    /** Whether plugins are updated automatically, or a specific update policy string. */
    autoUpdatePlugins: z.union([z.boolean(), z.string()]),
    /** Whether SSH sessions launch the default SSH app instead of Hyper's own client. */
    defaultSSHApp: z.boolean(),
    /** Whether automatic application updates are disabled. */
    disableAutoUpdates: z.boolean(),
    /** Release channel used when checking for application updates. */
    updateChannel: z.enum([
      /** Fully tested, general-availability releases. */
      'stable',
      /** Pre-release builds for early feedback. */
      'canary'
    ]),
    /** Whether the ConPTY backend is used for Windows shell sessions. */
    useConpty: z.boolean().optional()
  })
  .passthrough();

/** Fully resolved configOptions = root + profile + defaultProfile + profiles. */
const configOptionsSchema = rootConfigSchema
  .merge(profileConfigSchema)
  .extend({
    /** Name of the profile used when a session does not request one explicitly. */
    defaultProfile: z.string(),
    /** Named configuration profiles that can override the root/default settings. */
    profiles: z.array(
      z
        .object({
          /** Profile name, referenced by `defaultProfile` and session requests. */
          name: z.string(),
          /** Partial profile overrides applied on top of the default configuration. */
          config: profileConfigSchema.partial()
        })
        .passthrough()
    )
  })
  .passthrough();

/** Shared command-definition payload used by runtime plugin command sync. */
const commandDefinitionSchema = z
  .object({
    /** Stable identifier for the command, unique within its registering plugin. */
    id: z.string(),
    /** Whether the command runs in the renderer (frontend) or main (backend) process. */
    kind: z.enum([
      /** Executes in the renderer process. */
      'frontend',
      /** Executes in the main process. */
      'backend'
    ]),
    /** Display metadata used to present the command in menus and palettes. */
    metadata: z
      .object({
        /** Human-readable command name. */
        title: z.string(),
        /** Grouping used to organize commands in menus. */
        category: z.string().optional(),
        /** Longer explanation shown in command palette tooltips. */
        description: z.string().optional(),
        /** Search terms that help users find the command. */
        keywords: z.array(z.string()).optional(),
        /** Icon identifier shown alongside the command. */
        icon: z.string().optional()
      })
      .passthrough(),
    /** Expression controlling when the command is the default for its context. */
    defaultWhen: z.string().optional(),
    /** Schema describing the arguments the command accepts, if any. */
    argsSchema: z.record(z.string(), z.unknown()).optional(),
    /** Schema describing the command's result payload, if any. */
    resultSchema: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Runtime schema for every `IpcCommands` return type, keyed by command name.
 * Used by the transport layer to validate main-process responses before they
 * reach application code.
 *
 * The `satisfies` constraint ensures every `IpcCommands` key has a
 * corresponding schema. Per-key output types are not constrained against
 * `IpcCommands` return types because zod v4 `.passthrough()` infers output
 * properties as optional (`$loose` mode); runtime validation is the purpose
 * of this registry, and the `RendererCommandTransport` interface already
 * guarantees the correct return type at call sites.
 *
 * @internal
 */
export const ipcResponseSchemas = {
  /** Response for `child_process.exec`: captured stdout/stderr of the run. */
  'child_process.exec': childProcessResultSchema,
  /** Response for `child_process.execFile`: captured stdout/stderr of the run. */
  'child_process.execFile': childProcessResultSchema,
  /** Response for `getLoadedPluginVersions`: name/version pairs for active plugins. */
  getLoadedPluginVersions: z.array(
    z.object({
      /** Plugin package name. */
      name: z.string(),
      /** Installed plugin version string. */
      version: z.string()
    })
  ),
  /** Response for `getPaths`: filesystem locations of installed plugins. */
  getPaths: z.object({
    /** Plugins installed from the registry. */
    plugins: z.array(z.string()),
    /** Plugins loaded from the user's local plugin directory. */
    localPlugins: z.array(z.string())
  }),
  /** Response for `getBasePaths`: root directories used to resolve plugin paths. */
  getBasePaths: z.object({
    /** Base path for registry-installed plugins. */
    path: z.string(),
    /** Base path for locally developed plugins. */
    localPath: z.string()
  }),
  /** Response for `getDeprecatedConfig`: legacy per-plugin CSS overrides still in use. */
  getDeprecatedConfig: z.record(
    z.string(),
    z
      .object({
        /** Deprecated CSS rule strings applied by the plugin. */
        css: z.array(z.string())
      })
      .passthrough()
  ),
  /** Response for `getDecoratedConfig`: fully resolved configuration after plugin decoration. */
  getDecoratedConfig: configOptionsSchema,
  /** Response for `getDecoratedKeymaps`: keybinding action names to key combination strings. */
  getDecoratedKeymaps: z.record(z.string(), z.array(z.string())),
  /** Response for `getRuntimePluginCommands`: commands registered by loaded plugins. */
  getRuntimePluginCommands: z.array(commandDefinitionSchema)
} satisfies Record<keyof IpcCommands, ZodType>;
