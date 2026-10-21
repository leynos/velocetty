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

/**
 * Wraps each path in single quotes, escaping embedded quotes so the result is
 * safe to insert into a POSIX shell command line.
 *
 * Example:
 * - `quoteShellPaths(['/tmp/a b.txt'])` returns `'/tmp/a b.txt'`.
 */
export const quoteShellPaths = (paths: readonly string[]): string =>
  paths.map((path) => `'${path.replaceAll("'", "'\\''")}'`).join(' ');

/**
 * Formats copied file paths for the terminal, or returns `null` when the
 * clipboard holds no file list.
 *
 * The clipboard reader is injected so this module stays free of transport
 * wiring and can be unit tested without an Electron environment.
 *
 * Example:
 * - `processClipboard(async () => ['/tmp/a.txt'])` resolves to `'/tmp/a.txt'`.
 */
export default async function processClipboard(readFilePaths: () => Promise<string[]>): Promise<string | null> {
  const paths = await readFilePaths();
  return paths.length > 0 ? quoteShellPaths(paths) : null;
}
