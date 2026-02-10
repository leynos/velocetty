/** @file Configures Electron GPU startup behaviour from environment flags. */

type CommandLineSwitchAppender = {
  appendSwitch: (switchName: string, value?: string) => void;
};

type GpuConfigurableApp = {
  disableHardwareAcceleration: () => void;
  commandLine: CommandLineSwitchAppender;
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
 * Applies Chromium GPU-related startup switches before the app is ready.
 *
 * Example:
 * - `configureGpuMode(app, {VELOCETTY_DISABLE_GPU: '1'})` disables hardware acceleration.
 * - `configureGpuMode(app)` keeps the default GPU path and ignores the GPU blacklist.
 */
export const configureGpuMode = (electronApp: GpuConfigurableApp, env: NodeJS.ProcessEnv = process.env) => {
  if (shouldDisableGpu(env)) {
    console.log('VELOCETTY_DISABLE_GPU=1 detected, disabling hardware acceleration');
    electronApp.disableHardwareAcceleration();
    electronApp.commandLine.appendSwitch('disable-gpu');
    electronApp.commandLine.appendSwitch('disable-gpu-compositing');
    electronApp.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
    return;
  }

  console.log('Disabling Chromium GPU blacklist');
  electronApp.commandLine.appendSwitch('ignore-gpu-blacklist');
};
