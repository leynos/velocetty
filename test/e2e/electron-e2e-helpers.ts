/** @file Shared helpers for Electron E2E launch and timeout behaviour. */
import path from 'node:path';

type ResolveLaunchConfigOptions = {
  platform?: NodeJS.Platform;
  ci?: string;
  electronDisableSandbox?: string;
  baseDir?: string;
};

/**
 * Returns a promise that rejects when the timeout elapses.
 */
export const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (didTimeout) {
      void promise.catch(() => {});
    }
  }
};

/**
 * Resolves the packaged Electron binary path and platform-specific arguments.
 */
export const resolveLaunchConfig = (options: ResolveLaunchConfigOptions = {}) => {
  const platform = options.platform ?? process.platform;
  const ci = options.ci ?? process.env.CI;
  const electronDisableSandbox = options.electronDisableSandbox ?? process.env.ELECTRON_DISABLE_SANDBOX;
  const baseDir = options.baseDir ?? __dirname;

  let pathToBinary: string;
  const launchArgs: string[] = [];

  switch (platform) {
    case 'linux':
      pathToBinary = path.join(baseDir, '../../dist/linux-unpacked/hyper');
      break;
    case 'darwin':
      pathToBinary = path.join(baseDir, '../../dist/mac/Hyper.app/Contents/MacOS/Hyper');
      break;
    case 'win32':
      pathToBinary = path.join(baseDir, '../../dist/win-unpacked/Hyper.exe');
      break;
    default:
      throw new Error('Path to the built binary needs to be defined for this platform in E2E launch helpers.');
  }

  if (platform === 'linux' && (ci === 'true' || electronDisableSandbox === '1')) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return {pathToBinary, launchArgs};
};
