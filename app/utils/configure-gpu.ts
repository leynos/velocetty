/** @file Configures Electron GPU startup behaviour from environment flags. */

const DEFAULT_CHROMIUM_LOG_LEVEL = '3';
const shouldEmitGpuDiagnostics = (env: NodeJS.ProcessEnv = process.env) =>
  env.VELOCETTY_GPU_DIAGNOSTICS === '1' || env.VELOCETTY_DEBUG === '1';

const logGpuDiagnostics = (message: string, env: NodeJS.ProcessEnv) => {
  if (shouldEmitGpuDiagnostics(env)) {
    console.log(message);
  }
};

/**
 * Returns whether the app should force Chromium into software rendering mode.
 *
 * Example:
 * - `shouldDisableGpu({VELOCETTY_DISABLE_GPU: '1'})` returns `true`.
 * - `shouldDisableGpu({VELOCETTY_DISABLE_GPU: '0'})` returns `false`.
 */
export const shouldDisableGpu = (env: NodeJS.ProcessEnv = process.env) => env.VELOCETTY_DISABLE_GPU === '1';

/**
 * Returns whether Chromium error logging should be suppressed by default.
 *
 * Example:
 * - `shouldSuppressChromiumErrorLogs({VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS: '0'})` returns `false`.
 * - `shouldSuppressChromiumErrorLogs({})` returns `true`.
 */
export const shouldSuppressChromiumErrorLogs = (env: NodeJS.ProcessEnv = process.env) =>
  env.VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS !== '0';

/**
 * Applies Chromium GPU-related startup switches before the app is ready.
 *
 * Example:
 * - `configureGpuMode(app, {VELOCETTY_DISABLE_GPU: '1'})` disables hardware acceleration.
 * - `configureGpuMode(app)` keeps the default GPU path and ignores the GPU blacklist.
 */
export const configureGpuMode = (
  electronApp: {
    disableHardwareAcceleration: () => void;
    commandLine: {appendSwitch: (switchName: string, value?: string) => void};
  },
  env: NodeJS.ProcessEnv = process.env
) => {
  if (!shouldSuppressChromiumErrorLogs(env)) {
    logGpuDiagnostics('VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS=0 detected, keeping Chromium error logs enabled', env);
  } else {
    const logLevel = env.VELOCETTY_CHROMIUM_LOG_LEVEL?.trim() || DEFAULT_CHROMIUM_LOG_LEVEL;
    logGpuDiagnostics(`Applying Chromium log-level=${logLevel} to reduce known startup log noise`, env);
    electronApp.commandLine.appendSwitch('log-level', logLevel);
  }

  if (shouldDisableGpu(env)) {
    logGpuDiagnostics('VELOCETTY_DISABLE_GPU=1 detected, disabling hardware acceleration', env);
    electronApp.disableHardwareAcceleration();
    electronApp.commandLine.appendSwitch('disable-gpu');
    electronApp.commandLine.appendSwitch('disable-gpu-compositing');
    electronApp.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
    return;
  }

  logGpuDiagnostics('Disabling Chromium GPU blacklist', env);
  electronApp.commandLine.appendSwitch('ignore-gpu-blacklist');
};
