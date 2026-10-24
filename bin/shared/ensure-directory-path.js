import fs from 'node:fs';
import path from 'node:path';

/** @param {unknown} value @returns {value is object} */
const isObject = (value) => value !== null && Object(value) === value;

function isEnoentError(error) {
  return isObject(error) && 'code' in error && error.code === 'ENOENT';
}

async function ensureExistingPath(dirPath, stat) {
  if (stat.isDirectory()) {
    return;
  }

  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.promises.readlink(dirPath);
    const resolvedTarget = path.resolve(path.dirname(dirPath), linkTarget);
    await fs.promises.mkdir(resolvedTarget, {recursive: true});
    return;
  }

  throw new Error(`Expected "${dirPath}" to be a directory path.`);
}

/**
 * Ensures a directory path exists, including when the path is a symlink to a
 * directory target that may not exist yet.
 *
 * @param {string} dirPath
 * @returns {Promise<void>}
 */
export async function ensureDirectoryPath(dirPath) {
  let stat;
  try {
    stat = await fs.promises.lstat(dirPath);
  } catch (error) {
    if (isEnoentError(error)) {
      await fs.promises.mkdir(dirPath, {recursive: true});
      return;
    }

    throw error;
  }
  await ensureExistingPath(dirPath, stat);
}
