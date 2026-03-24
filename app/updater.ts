/**
 * @file Initialises the auto-updater, wires platform-specific update events,
 * and manages update-channel configuration.
 */
// Packages
import electron, {app} from 'electron';
import type {BrowserWindow, AutoUpdater} from 'electron';

import retry from 'async-retry';
import ms from 'ms';

// Utilities
import autoUpdaterLinux from './auto-updater-linux';
import {getDefaultProfile} from './config';
import {version} from './package.json';
import {getDecoratedConfig} from './plugins';

const {platform} = process;
const isLinux = platform === 'linux';

type LinuxUpdateAvailableArgs = [
  event?: Electron.Event,
  releaseNotes?: string,
  releaseName?: string,
  releaseDate?: Date,
  updateUrl?: string
];

const autoUpdater: AutoUpdater = isLinux ? autoUpdaterLinux : electron.autoUpdater;

const getDecoratedConfigWithRetry = async () => {
  return await retry(() => {
    const content = getDecoratedConfig(getDefaultProfile());
    if (!content) {
      throw new Error('No config content loaded');
    }
    return content;
  });
};

const checkForUpdates = async () => {
  const config = await getDecoratedConfigWithRetry();
  if (!config.disableAutoUpdates) {
    autoUpdater.checkForUpdates();
  }
};

let isInit = false;
let isInitializing = false;
// Default to the "stable" update channel
let canaryUpdates = false;

const buildFeedUrl = (canary: boolean) => {
  const updatePrefix = canary ? 'releases-canary' : 'releases';
  const archSuffix = process.arch === 'arm64' || app.runningUnderARM64Translation ? '_arm64' : '';
  return `https://${updatePrefix}.hyper.is/update/${isLinux ? 'deb' : platform}${archSuffix}/${version}`;
};

/**
 * Checks if the raw config channel value indicates canary updates.
 * Treats undefined and non-'canary' values as stable.
 */
const isCanaryChannel = (raw?: string): boolean => raw === 'canary';

/**
 * Scheduler seam for timer operations.
 * Allows injection of test doubles in unit tests.
 */
interface SchedulerSeam {
  setTimeout: typeof globalThis.setTimeout;
  setInterval: typeof globalThis.setInterval;
}

/**
 * Logger seam for error logging.
 * Allows injection of test doubles in unit tests.
 */
interface LoggerSeam {
  error: (...args: unknown[]) => void;
}

/** Value object carrying the metadata emitted for an available update. */
interface ReleaseInfo {
  readonly releaseNotes: string;
  readonly releaseName: string;
  readonly updateUrl?: string;
}

/**
 * Options for the updater function.
 */
export interface UpdaterOptions {
  scheduler?: SchedulerSeam;
  logger?: LoggerSeam;
}

async function init(scheduler: SchedulerSeam, logger: LoggerSeam) {
  if (isInitializing) return;
  isInitializing = true;

  try {
    autoUpdater.on('error', (err) => {
      logger.error('Error fetching updates', `${err.message} (${err.stack})`);
    });

    const config = await getDecoratedConfigWithRetry();

    // If defined in the config, switch to the "canary" channel
    if (isCanaryChannel(config.updateChannel)) {
      canaryUpdates = true;
    }

    const feedURL = buildFeedUrl(canaryUpdates);

    autoUpdater.setFeedURL({url: feedURL});

    if (process.env.NODE_ENV !== 'test') {
      scheduler.setTimeout(() => {
        void checkForUpdates();
      }, ms('10s'));

      scheduler.setInterval(() => {
        void checkForUpdates();
      }, ms('30m'));
    }

    isInit = true;
  } finally {
    isInitializing = false;
  }
}

const updater = (win: BrowserWindow, options?: UpdaterOptions) => {
  const scheduler = options?.scheduler ?? {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval
  };
  const logger = options?.logger ?? console;

  if (!isInit && !isInitializing) {
    void init(scheduler, logger);
  }

  const {rpc} = win;

  const emitUpdateAvailable = ({releaseNotes, releaseName, updateUrl}: ReleaseInfo) => {
    const releaseUrl = updateUrl || `https://github.com/vercel/hyper/releases/tag/${releaseName}`;
    rpc.emit('update available', {releaseNotes, releaseName, releaseUrl, canInstall: !isLinux});
  };

  /**
   * Electron types `update-available` as a zero-argument event, while our Linux
   * shim emits metadata arguments. Keep a typed zero-arg listener for
   * subscription and parse optional payload args for Linux runtime parity.
   */
  const onLinuxUpdateAvailable = (...args: LinuxUpdateAvailableArgs) => {
    const [_event, releaseNotes = '', releaseNameArg, _releaseDate, updateUrlArg = ''] = args;
    const releaseName = releaseNameArg || version;
    const updateUrl = updateUrlArg || undefined;

    emitUpdateAvailable({releaseNotes, releaseName, updateUrl});
  };

  const onUpdateDownloaded = (
    _ev: Electron.Event,
    releaseNotes: string,
    releaseName: string,
    _date: Date,
    updateUrl: string
  ) => {
    emitUpdateAvailable({releaseNotes, releaseName, updateUrl});
  };

  if (isLinux) {
    autoUpdater.on('update-available', onLinuxUpdateAvailable);
  } else {
    autoUpdater.on('update-downloaded', onUpdateDownloaded);
  }

  rpc.once('quit and install', () => {
    autoUpdater.quitAndInstall();
  });

  app.config.subscribe(async () => {
    const {updateChannel} = await getDecoratedConfigWithRetry();
    const newUpdateIsCanary = isCanaryChannel(updateChannel);

    if (newUpdateIsCanary !== canaryUpdates) {
      const feedURL = buildFeedUrl(newUpdateIsCanary);

      autoUpdater.setFeedURL({url: feedURL});
      void checkForUpdates();

      canaryUpdates = newUpdateIsCanary;
    }
  });

  win.on('close', () => {
    if (isLinux) {
      autoUpdater.removeListener('update-available', onLinuxUpdateAvailable);
    } else {
      autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
    }
  });
};

export default updater;
