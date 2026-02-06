/** @file Shared helpers for Electron E2E launch and timeout behaviour. */
import path from 'node:path';

type ResolveLaunchConfigOptions = {
  platform?: NodeJS.Platform;
  ci?: string;
  electronDisableSandbox?: string;
  baseDir?: string;
};

type SupportedPlatform = 'linux' | 'darwin' | 'win32';

const isSupportedPlatform = (platform: NodeJS.Platform): platform is SupportedPlatform =>
  platform === 'linux' || platform === 'darwin' || platform === 'win32';

const assertNever = (value: never): never => {
  throw new Error(`Unsupported platform: ${String(value)}`);
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
  if (!isSupportedPlatform(platform)) {
    throw new Error('Path to the built binary needs to be defined for this platform in E2E launch helpers.');
  }
  const ci = options.ci ?? process.env.CI;
  const electronDisableSandbox = options.electronDisableSandbox ?? process.env.ELECTRON_DISABLE_SANDBOX;
  // Bun provides __dirname in .ts modules used by this test helper.
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
      return assertNever(platform);
  }

  if (platform === 'linux' && (ci === 'true' || electronDisableSandbox === '1')) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return {pathToBinary, launchArgs};
};
