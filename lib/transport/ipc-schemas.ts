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
  stdout: stdioValueSchema,
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
    black: z.string(),
    blue: z.string(),
    cyan: z.string(),
    green: z.string(),
    lightBlack: z.string(),
    lightBlue: z.string(),
    lightCyan: z.string(),
    lightGreen: z.string(),
    lightMagenta: z.string(),
    lightRed: z.string(),
    lightWhite: z.string(),
    lightYellow: z.string(),
    magenta: z.string(),
    red: z.string(),
    white: z.string(),
    yellow: z.string()
  })
  .passthrough();

/** Profile-level configuration fields. */
const profileConfigSchema = z
  .object({
    backgroundColor: z.string(),
    bell: z.union([z.literal('SOUND'), z.literal(false)]),
    bellSound: z.string().nullable(),
    bellSoundURL: z.string().nullable(),
    borderColor: z.string(),
    colors: colorMapSchema,
    copyOnSelect: z.boolean(),
    css: z.string(),
    cursorAccentColor: z.string(),
    cursorBlink: z.boolean(),
    cursorColor: z.string(),
    cursorShape: z.enum(['BEAM', 'UNDERLINE', 'BLOCK']),
    disableLigatures: z.boolean(),
    env: z.record(z.string(), z.string()),
    fontFamily: z.string(),
    fontSize: z.number(),
    fontWeight: fontWeightSchema,
    fontWeightBold: fontWeightSchema,
    foregroundColor: z.string(),
    imageSupport: z.boolean(),
    letterSpacing: z.number(),
    lineHeight: z.number(),
    macOptionSelectionMode: z.string(),
    modifierKeys: z
      .object({
        altIsMeta: z.boolean(),
        cmdIsMeta: z.boolean()
      })
      .optional(),
    padding: z.string(),
    preserveCWD: z.boolean(),
    quickEdit: z.boolean(),
    screenReaderMode: z.boolean(),
    scrollback: z.number(),
    selectionColor: z.string(),
    shell: z.string(),
    shellArgs: z.array(z.string()),
    showHamburgerMenu: z.union([z.boolean(), z.literal('')]),
    showWindowControls: z.union([z.boolean(), z.literal('left'), z.literal('')]),
    termCSS: z.string(),
    uiFontFamily: z.string().optional(),
    webGLRenderer: z.boolean(),
    webLinksActivationKey: z.enum(['ctrl', 'alt', 'meta', 'shift', '']),
    windowSize: z.tuple([z.number(), z.number()]).optional(),
    workingDirectory: z.string()
  })
  .passthrough();

/** Root-level configuration fields. */
const rootConfigSchema = z
  .object({
    autoUpdatePlugins: z.union([z.boolean(), z.string()]),
    defaultSSHApp: z.boolean(),
    disableAutoUpdates: z.boolean(),
    updateChannel: z.enum(['stable', 'canary']),
    useConpty: z.boolean().optional()
  })
  .passthrough();

/** Fully resolved configOptions = root + profile + defaultProfile + profiles. */
const configOptionsSchema = rootConfigSchema
  .merge(profileConfigSchema)
  .extend({
    defaultProfile: z.string(),
    profiles: z.array(
      z
        .object({
          name: z.string(),
          config: profileConfigSchema.partial()
        })
        .passthrough()
    )
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
 */
export const ipcResponseSchemas = {
  'child_process.exec': childProcessResultSchema,
  'child_process.execFile': childProcessResultSchema,
  getLoadedPluginVersions: z.array(z.object({name: z.string(), version: z.string()})),
  getPaths: z.object({plugins: z.array(z.string()), localPlugins: z.array(z.string())}),
  getBasePaths: z.object({path: z.string(), localPath: z.string()}),
  getDeprecatedConfig: z.record(z.string(), z.object({css: z.array(z.string())}).passthrough()),
  getDecoratedConfig: configOptionsSchema,
  getDecoratedKeymaps: z.record(z.string(), z.array(z.string()))
} satisfies Record<keyof IpcCommands, ZodType>;
