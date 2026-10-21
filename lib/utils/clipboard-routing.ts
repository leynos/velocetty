/**
 * @file Routes terminal clipboard operations through injected main-process ports.
 *
 * Electron 44 removed the renderer `clipboard` module (RFC 0019), so the
 * renderer cannot read or write the system clipboard itself. `Term` supplies
 * these operations as transport calls; keeping the sequencing here lets the
 * component stay focused on xterm integration and makes the fallback rules
 * testable without an Electron environment.
 *
 * Invariants:
 * - A failed file-list read never loses the paste: native paste is already
 *   cancelled by the time these run, so the text read still happens.
 * - A failed clipboard read propagates to the caller, which owns the message
 *   shown for a paste that could not complete.
 * - A failed clipboard write is logged and swallowed, because copy is
 *   fire-and-forget and has no user-visible failure path.
 *
 * Cross-links:
 * - Component: `lib/components/term.tsx`
 * - Path formatting: `lib/utils/paste.ts`
 */
import processClipboard from './paste';

/** Main-process clipboard operations the renderer may invoke. */
export type ClipboardReadPorts = Readonly<{
  readFilePaths: () => Promise<string[]>;
  readText: () => Promise<string>;
}>;

/**
 * Resolves the text a paste should insert into the terminal.
 *
 * A copied file list is preferred and formatted for `platform`'s shell. When
 * the clipboard holds no file list — or the file-list read fails — this falls
 * back to the clipboard's plain text.
 *
 * Example:
 * - With no copied files, `readPastePayload(ports, 'darwin')` resolves to the
 *   clipboard text.
 */
export const readPastePayload = async (ports: ClipboardReadPorts, platform: string): Promise<string> => {
  let formattedPaths: string | null = null;
  try {
    formattedPaths = await processClipboard(ports.readFilePaths, platform);
  } catch (error) {
    console.warn('Failed to read copied files from the clipboard.', error);
  }

  // Kept outside the block above so a failed file-list read still pastes text.
  return formattedPaths ?? ports.readText();
};

/**
 * Writes `text` to the clipboard, logging rather than rejecting on failure.
 *
 * Example:
 * - `copyText(writeText, 'hello')` resolves even when `writeText` rejects.
 */
export const copyText = async (writeText: (text: string) => Promise<void>, text: string): Promise<void> => {
  try {
    await writeText(text);
  } catch (error) {
    console.warn('Failed to copy the selection to the clipboard.', error);
  }
};
