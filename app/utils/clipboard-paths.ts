/** @file Parses file paths from the OS "copied files" clipboard format. */
import {fileURLToPath} from 'node:url';

/**
 * Payload shapes this module can read from a clipboard entry.
 *
 * Electron resolves `ClipboardItem.getType` to a `Blob` for the URI-list MIME
 * type; the `string` arm covers test doubles and platforms that hand the list
 * over as text.
 */
export type ClipboardPayload = string | Blob;

/** A single clipboard entry exposes its MIME types and payload getter. */
export type ClipboardItemPort = {
  readonly types: readonly string[];
  /**
   * Resolves to the payload for `type`, or `null` when the platform supplies
   * it in a shape that is not readable text.
   */
  getType(type: string): Promise<ClipboardPayload | null>;
};

/** The subset of Electron's clipboard API needed to read copied files. */
export type ClipboardPort = {
  read(): Promise<readonly ClipboardItemPort[]>;
};

/**
 * MIME type that maps to the operating system's native "copied files"
 * clipboard format (`CF_HDROP` on Windows, `NSFilenamesPboardType` on macOS,
 * and `text/uri-list` on Linux).
 */
export const CLIPBOARD_URI_LIST_MIME = 'text/uri-list';

const toFilePath = (uri: string): string | null => {
  try {
    const url = new URL(uri);
    return url.protocol === 'file:' ? fileURLToPath(url) : null;
  } catch {
    // A malformed URI list must not break paste; skip the offending line.
    return null;
  }
};

/**
 * Extracts absolute file paths from an RFC 2483 URI list.
 *
 * Blank lines and `#` comments are ignored, as are non-`file:` URIs because
 * the terminal paste path only understands local files.
 *
 * Example:
 * - `parseUriList('file:///tmp/a%20b.txt\r\nfile:///tmp/c.txt')` returns
 *   `['/tmp/a b.txt', '/tmp/c.txt']`.
 */
export const parseUriList = (uriList: string): string[] =>
  uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => toFilePath(line))
    .filter((path): path is string => path !== null);

const readPayloadText = async (payload: ClipboardPayload | null): Promise<string | null> => {
  if (payload === null) {
    return null;
  }
  return payload instanceof Blob ? payload.text() : payload;
};

/**
 * Reads absolute file paths from the privileged main-process clipboard.
 *
 * Returns an empty array when the clipboard carries no file list, so callers
 * can fall back to the browser's normal text paste.
 *
 * Example:
 * - A clipboard holding `file:///tmp/a.txt` resolves to `['/tmp/a.txt']`.
 */
export const readClipboardFilePaths = async (clipboard: ClipboardPort): Promise<string[]> => {
  const items = await clipboard.read();
  for (const item of items) {
    if (!item.types.includes(CLIPBOARD_URI_LIST_MIME)) {
      continue;
    }
    const text = await readPayloadText(await item.getType(CLIPBOARD_URI_LIST_MIME));
    if (text !== null) {
      return parseUriList(text);
    }
  }
  return [];
};
