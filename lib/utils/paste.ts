/** @file Formats clipboard file lists into shell-safe text for terminal paste. */

/**
 * Platforms whose clipboard exposes copied files as a native file list that
 * the renderer cannot read directly, so paste must be resolved in the main
 * process. Linux already pastes the file paths as plain text.
 */
const FILE_LIST_PLATFORMS = new Set(['darwin', 'win32']);

/** Whether a paste event should be intercepted to resolve a copied file list. */
export const shouldInterceptFilePaste = (platform: string = process.platform): boolean =>
  FILE_LIST_PLATFORMS.has(platform);

/** Wraps a path in single quotes, escaping embedded quotes for a POSIX shell. */
const quotePosixPath = (path: string): string => `'${path.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Wraps a Windows path in double quotes.
 *
 * Windows file names cannot contain `"`, so no escaping is needed and
 * `cmd.exe` treats the quoted path as a single word. PowerShell still expands
 * `$` and backticks inside double quotes, but the configured shell is not
 * available to the renderer; this follows the `cmd.exe` convention already
 * used for escaped input in `app/ui/window.ts` rather than guessing further.
 */
const quoteWindowsPath = (path: string): string => `"${path}"`;

/**
 * Quotes each path for the shell conventions of `platform`.
 *
 * Every platform that reaches this function uses one of the two forms: paste
 * interception only selects `darwin` or `win32`, and macOS shells are POSIX.
 *
 * Example:
 * - `quoteShellPaths(['/tmp/a b.txt'], 'linux')` returns `'/tmp/a b.txt'`.
 * - `quoteShellPaths(['C:\\a b.txt'], 'win32')` returns `"C:\\a b.txt"`.
 */
export const quoteShellPaths = (paths: readonly string[], platform: string = process.platform): string =>
  paths.map((path) => (platform === 'win32' ? quoteWindowsPath(path) : quotePosixPath(path))).join(' ');

/**
 * Formats copied file paths for the terminal, or returns `null` when the
 * clipboard holds no file list.
 *
 * The clipboard reader is injected so this module stays free of transport
 * wiring and can be unit tested without an Electron environment.
 *
 * Example:
 * - `processClipboard(async () => ['/tmp/a.txt'], 'linux')` resolves to
 *   `'/tmp/a.txt'`.
 */
export default async function processClipboard(
  readFilePaths: () => Promise<string[]>,
  platform: string = process.platform
): Promise<string | null> {
  const paths = await readFilePaths();
  return paths.length > 0 ? quoteShellPaths(paths, platform) : null;
}
