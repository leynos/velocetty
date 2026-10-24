/** @file Installs the Hyper CLI helper by adding links or PATH entries. */
import {existsSync, readlink, symlink} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import {clipboard, dialog} from 'electron';

import {mkdirpSync} from 'fs-extra';
import * as Registry from 'native-reg';
import type {ValueType} from 'native-reg';
import sudoPrompt from 'sudo-prompt';
import {isObject, isString} from './runtime-guards';

import {cliScriptPath, cliLinkPath} from '../config/paths';
import notify from '../notify';

const readLink = promisify(readlink);
const symLink = promisify(symlink);
const sudoExec = promisify(sudoPrompt.exec);

/** The `ln` invocation the elevated fallback runs, without its `sudo` prefix. */
const lnCommand = `ln -sf "${cliScriptPath}" "${cliLinkPath}"`;

/** Reads a string `code` property from a thrown value, when it has one. */
const getErrorCode = (error: unknown): string | undefined =>
  isObject(error) && 'code' in error && isString(error.code) ? error.code : undefined;

const checkInstall = async (): Promise<boolean> => {
  try {
    return (await readLink(cliLinkPath)) === cliScriptPath;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

/**
 * Describes why creating the symlink failed.
 *
 * `readlink` reports EINVAL and `symlink` reports EEXIST when a link is
 * already there, so both mean the same thing to the user.
 */
const describeSymlinkError = (caughtError: unknown): string => {
  const errorCode = getErrorCode(caughtError);
  if (errorCode === 'EEXIST' || errorCode === 'EINVAL') {
    return `File already exists: ${cliLinkPath}`;
  }
  const errorMessage = caughtError instanceof Error ? caughtError.message : undefined;
  const detail = errorCode ?? 'Unknown error';
  return `Symlink creation failed: ${detail}${errorMessage ? ` (${errorMessage})` : ''}`;
};

/**
 * Offers the user an elevated retry for a symlink that needs root.
 *
 * Resolves `null` when the elevated command installed the link. Otherwise the
 * failure is explained by sudo when it ran and failed, and left to the caller
 * when the user declined or cancelled.
 */
const runSudoSymlink = async (): Promise<string | null> => {
  const result = await dialog.showMessageBox({
    message: `You need to grant elevated privileges to add Hyper CLI to PATH
Or you can run
sudo ${lnCommand}`,
    type: 'info',
    buttons: ['OK', 'Copy Command', 'Cancel']
  });
  if (result.response === 1) {
    await clipboard.writeText(`sudo ${lnCommand}`);
    return null;
  }
  if (result.response !== 0) {
    return null;
  }
  try {
    await sudoExec(lnCommand, {name: 'Hyper'});
    return null;
  } catch (error) {
    const sudoError = Array.isArray(error) ? error[0] : error;
    return isString(sudoError) ? sudoError : `Symlink creation failed: ${String(sudoError)}`;
  }
};

/**
 * Explains a symlink failure, running the sudo fallback when it applies.
 *
 * Returns `null` when the elevated retry installed the link, so the caller can
 * treat the attempt as successful.
 */
const resolveSymlinkFailure = async (caughtError: unknown, silent: boolean): Promise<string | null> => {
  // Need sudo access to create symlink
  if (getErrorCode(caughtError) !== 'EACCES' || silent) {
    return describeSymlinkError(caughtError);
  }
  return (await runSudoSymlink()) ?? describeSymlinkError(caughtError);
};

/** Creates the directory the CLI link lives in, when it is missing. */
const ensureLinkDirectory = (): void => {
  const linkDirectory = path.dirname(cliLinkPath);
  if (existsSync(linkDirectory)) {
    return;
  }
  try {
    mkdirpSync(linkDirectory);
  } catch (error) {
    throw `Failed to create directory ${linkDirectory} - ${error}`;
  }
};

/** Links the CLI script into the directory on PATH. */
const createCliSymlink = async (): Promise<void> => {
  if (await checkInstall()) {
    console.log('Hyper CLI already in PATH');
    return;
  }
  console.log('Linking HyperCLI');
  ensureLinkDirectory();
  await symLink(cliScriptPath, cliLinkPath);
};

const addSymlink = async (silent: boolean) => {
  try {
    await createCliSymlink();
  } catch (caughtError) {
    const failure = await resolveSymlinkFailure(caughtError, silent);
    if (failure !== null) {
      throw failure;
    }
  }
};

/** The registry value holding the user's PATH, and the type it is stored as. */
type PathValue = {name: string; type: ValueType; value: string};

/**
 * The two directories the installer cares about.
 *
 * They travel together everywhere, and naming the pair keeps the current and
 * superseded locations from being swapped at a call site.
 */
type PathLayout = {
  /** Where the CLI script lives: `…\hyper\resources\bin`. */
  binPath: string;
  /** The squirrel-era install root, `…\AppData\Local\hyper`. */
  oldPath: string;
};

/** The two registry types whose contents are a plain path string. */
const isPathValueType = (type: ValueType): boolean =>
  type === Registry.ValueType.SZ || type === Registry.ValueType.EXPAND_SZ;

/**
 * Rebuilds the PATH string, dropping the superseded install prefix.
 *
 * Because the nsis install path differs from squirrel's we need to remove the
 * old path if present and add the current one if absent.
 */
const mergePathEntries = (existingValue: string, layout: PathLayout): string => {
  const pathParts = existingValue.split(';').filter((pathPart) => !pathPart.startsWith(layout.oldPath));
  if (!pathParts.includes(layout.binPath)) {
    pathParts.push(layout.binPath);
  }
  return pathParts.join(';');
};

/** Outcome of reading PATH: an absent value, a usable one, or why it cannot be used. */
type PathRead = {kind: 'absent'} | {kind: 'usable'; pathValue: PathValue} | {kind: 'unusable'; message: string};

/**
 * Reads the PATH entry, distinguishing an absent value from an unusable one.
 *
 * Only the absent case may be created from scratch, so the two cannot share a
 * `null`. The rejection messages are the ones the installer has always
 * reported for each condition.
 */
const readPathValue = (envKey: Registry.HKEY, pathItem: string | undefined): PathRead => {
  if (!pathItem) {
    return {kind: 'absent'};
  }
  const type = Registry.queryValueRaw(envKey, pathItem)?.type ?? Registry.ValueType.SZ;
  if (!isPathValueType(type)) {
    return {kind: 'unusable', message: `Registry key type is ${type}`};
  }
  const registryValue = Registry.queryValue(envKey, pathItem);
  if (!isString(registryValue)) {
    return {kind: 'unusable', message: 'Registry PATH value is not a string'};
  }
  return {kind: 'usable', pathValue: {name: pathItem, type, value: registryValue}};
};

/** Outcome of planning the PATH write: skip, write, or reject with a message. */
type PathWrite = {kind: 'skip'} | {kind: 'write'; pathValue: PathValue} | {kind: 'reject'; message: string};

/**
 * Computes the registry write for the CLI's bin directory.
 *
 * Resolves `skip` when PATH already contains the current bin directory and no
 * superseded entry, so no write is needed.
 */
const resolvePathWrite = (envKey: Registry.HKEY, layout: PathLayout): PathWrite => {
  const pathItem = Registry.enumValueNames(envKey).find((item) => item.toUpperCase() === 'PATH');
  const read = readPathValue(envKey, pathItem);
  if (read.kind === 'unusable') {
    return {kind: 'reject', message: read.message};
  }
  if (read.kind === 'absent') {
    return {kind: 'write', pathValue: {name: 'PATH', type: Registry.ValueType.SZ, value: layout.binPath}};
  }
  const {pathValue} = read;
  const pathParts = pathValue.value.split(';');
  const isAlreadyPresent = pathParts.includes(layout.binPath);
  const hasOldPath = pathParts.some((pathPart) => pathPart.startsWith(layout.oldPath));
  if (isAlreadyPresent && !hasOldPath) {
    return {kind: 'skip'};
  }
  return {kind: 'write', pathValue: {...pathValue, value: mergePathEntries(pathValue.value, layout)}};
};

/** The directories this install manages, derived from the packaged paths. */
const resolvePathLayout = (): PathLayout => ({
  // C:\Users\<user>\AppData\Local\Programs\hyper\resources\bin
  binPath: path.dirname(cliScriptPath),
  // C:\Users\<user>\AppData\Local\hyper
  oldPath: path.resolve(process.env.LOCALAPPDATA!, 'hyper')
});

const addBinToUserPath = () => {
  return new Promise<void>((resolve, reject) => {
    try {
      const envKey = Registry.openKey(Registry.HKCU, 'Environment', Registry.Access.ALL_ACCESS)!;

      const write = resolvePathWrite(envKey, resolvePathLayout());
      if (write.kind === 'reject') {
        reject(write.message);
        return;
      }
      if (write.kind === 'skip') {
        console.log('Hyper CLI already in PATH');
        Registry.closeKey(envKey);
        resolve();
        return;
      }

      console.log('Adding HyperCLI path (registry)');
      const {pathValue} = write;
      Registry.setValueRaw(envKey, pathValue.name, pathValue.type, Registry.formatString(pathValue.value));
      Registry.closeKey(envKey);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};

/** A user-visible outcome, reported to the console and optionally as a notification. */
type InstallReport = {title: string; body: string};

const logNotify = (withNotification: boolean, report: InstallReport) => {
  console.log(report.title, report.body);
  withNotification && notify(report.title, report.body);
};

const reportInstalled = (body: string): InstallReport => ({title: 'Hyper CLI installed', body});

const reportFailure = (body: string): InstallReport => ({title: 'Hyper CLI installation failed', body});

export const installCLI = async (withNotification: boolean) => {
  if (process.platform === 'win32') {
    try {
      await addBinToUserPath();
      logNotify(
        withNotification,
        reportInstalled('You may need to restart your computer to complete this installation process.')
      );
    } catch (error) {
      logNotify(withNotification, reportFailure(`Failed to add Hyper CLI path to user PATH ${error}`));
    }
  } else if (process.platform === 'darwin' || process.platform === 'linux') {
    // AppImages are mounted on run at a temporary path, don't create symlink
    if (process.env.APPIMAGE) {
      console.log('Skipping CLI symlink creation as it is an AppImage install');
      return;
    }
    try {
      await addSymlink(!withNotification);
      logNotify(withNotification, reportInstalled(`Symlink created at ${cliLinkPath}`));
    } catch (error) {
      logNotify(withNotification, reportFailure(`${error}`));
    }
  } else {
    logNotify(withNotification, reportFailure(`Unsupported platform ${process.platform}`));
  }
};
