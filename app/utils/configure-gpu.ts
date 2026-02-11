/** @file Configures Electron GPU startup behaviour from environment flags. */

const DEFAULT_CHROMIUM_LOG_LEVEL = '3';

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
  const shouldEmitGpuDiagnostics = env.VELOCETTY_GPU_DIAGNOSTICS === '1' || env.VELOCETTY_DEBUG === '1';
  const logGpuDiagnostics = (message: string) => {
    if (shouldEmitGpuDiagnostics) {
      console.log(message);
    }
  };
  const shouldSuppressChromiumErrorLogs = env.VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS !== '0';

  if (!shouldSuppressChromiumErrorLogs) {
    logGpuDiagnostics('VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS=0 detected, keeping Chromium error logs enabled');
  } else {
    const logLevel = env.VELOCETTY_CHROMIUM_LOG_LEVEL?.trim() || DEFAULT_CHROMIUM_LOG_LEVEL;
    logGpuDiagnostics(`Applying Chromium log-level=${logLevel} to reduce known startup log noise`);
    electronApp.commandLine.appendSwitch('log-level', logLevel);
  }

  if (env.VELOCETTY_DISABLE_GPU === '1') {
    logGpuDiagnostics('VELOCETTY_DISABLE_GPU=1 detected, disabling hardware acceleration');
    electronApp.disableHardwareAcceleration();
    electronApp.commandLine.appendSwitch('disable-gpu');
    electronApp.commandLine.appendSwitch('disable-gpu-compositing');
    electronApp.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
    return;
  }

  logGpuDiagnostics('Disabling Chromium GPU blacklist');
  electronApp.commandLine.appendSwitch('ignore-gpu-blacklist');
};
