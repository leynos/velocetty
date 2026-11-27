/**
 * @file The source kind of the active settings file, decided at composition.
 *
 * The settings service must not derive policy from a file path: a legacy
 * `hyper.json` is read-only and a `config.json5` is editable, and that is a
 * decision only the composition root can make, from the same resolved path it
 * hands to the service. The service receives the kind, never the rule.
 */

/** How the active settings file may be treated. */
export type SettingsFileKind = 'json5' | 'legacy-json';

/**
 * Classifies an already-resolved config path.
 *
 * @param filePath - The resolved path the service will read and write.
 * @returns `legacy-json` for a `.json` file, `json5` otherwise.
 *
 * @example
 * ```ts
 * fileKindFor('/home/me/.config/Hyper/config.json5'); // 'json5'
 * fileKindFor('/home/me/.config/Hyper/hyper.json'); // 'legacy-json'
 * ```
 */
export const fileKindFor = (filePath: string): SettingsFileKind =>
  filePath.toLowerCase().endsWith('.json') ? 'legacy-json' : 'json5';
