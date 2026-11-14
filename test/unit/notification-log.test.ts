/** @file KB-O11Y: the shared notification sink logs no user-facing text. */
import {afterEach, describe, expect, mock, spyOn, test} from 'bun:test';

import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {logNotificationShown, type NotificationLogSinks} from '../../app/utils/notification-log';
import {importFresh} from '../testUtils/import-fresh';
import {registerModuleMock} from '../testUtils/mock-module';

// App code resolves Electron from `app/node_modules`, so the bare specifier
// alone would leave the real module in place.
const appRequire = createRequire(fileURLToPath(new URL('../../app/updater.ts', import.meta.url)));
const electronPath = realpathSync(appRequire.resolve('electron'));

/** A command identifier and a path a user could plausibly have written. */
const COMMAND_ID = 'window:open-private-notes';
const USER_PATH = '/home/ada/private/notes.txt';
/** An errno-shaped value that is not an errno, so a shape test alone would pass it. */
const SENSITIVE_TOKEN = 'PRIVATE_TOKEN';

/** The paths module stub, which only needs to expose the icon the notifier uses. */
const pathsMock = () => ({icon: '/tmp/icon.png'});

/** Captures both sinks so a test can inspect exactly what reached the log. */
const createSinks = () => {
  const info: string[] = [];
  const errors: unknown[][] = [];
  const sinks: NotificationLogSinks = {
    error: (...args) => {
      errors.push(args);
    },
    info: (line) => {
      info.push(line);
    }
  };
  return {errors, info, sinks};
};

describe('logNotificationShown', () => {
  test('records a fixed marker and never the title or body', () => {
    const {info, sinks} = createSinks();

    logNotificationShown({}, sinks);

    expect(info).toEqual(['[Notification] Notification shown.']);
  });

  test('records the bounded error description, not its message', () => {
    const {errors, info, sinks} = createSinks();
    const error = Object.assign(new Error(`ENOENT: no such file, open '${USER_PATH}'`), {code: 'ENOENT'});

    logNotificationShown({error}, sinks);

    expect(info).toEqual(['[Notification] Notification shown.']);
    expect(errors).toEqual([['[Notification]', {error: {code: 'ENOENT', name: 'Error'}}]]);
    expect(JSON.stringify([info, errors])).not.toContain(USER_PATH);
  });

  test('records the bounded operation and category without an error', () => {
    const {errors, sinks} = createSinks();

    logNotificationShown({category: 'invalid-return', operation: 'plugin-decoration'}, sinks);

    expect(errors).toEqual([['[Notification]', {category: 'invalid-return', operation: 'plugin-decoration'}]]);
  });

  test('drops a path smuggled through the code or the name', () => {
    const {errors, sinks} = createSinks();
    const error = Object.assign(new Error(`open '${USER_PATH}'`), {code: USER_PATH, name: USER_PATH});

    logNotificationShown({error}, sinks);

    // Both fields are writable, so neither may pass a path through unchanged.
    expect(errors).toEqual([['[Notification]', {error: {name: 'Error'}}]]);
    expect(JSON.stringify(errors)).not.toContain(USER_PATH);
  });

  test('describes a non-Error thrown value without inventing a code', () => {
    const {errors, sinks} = createSinks();

    logNotificationShown({error: COMMAND_ID}, sinks);

    expect(errors).toEqual([['[Notification]', {error: {name: 'UnknownError'}}]]);
    expect(JSON.stringify(errors)).not.toContain(COMMAND_ID);
  });
});

describe('notify', () => {
  afterEach(() => {
    mock.restore();
  });

  /**
   * Stubs the modules the notifier resolves, records what it shows, and loads it
   * under a cache key of its own so each test gets untouched module state.
   */
  const loadNotify = async (shown: Array<{readonly body: string; readonly title: string}>, key: string) => {
    const electronMock = () => ({
      app: {isReady: () => true, on: () => {}},
      Notification: class {
        constructor(options: {readonly body: string; readonly title: string}) {
          shown.push(options);
        }
        show() {}
      }
    });
    registerModuleMock('electron', electronMock);
    registerModuleMock(electronPath, electronMock);
    registerModuleMock('../../app/config/paths', pathsMock);
    registerModuleMock('../../app/config/paths.ts', pathsMock);
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const {default: notify} = await importFresh<typeof import('../../app/notify')>('../../app/notify', key);
    return {errorSpy, logSpy, notify};
  };

  test('shows the full text while the log keeps only the bounded marker', async () => {
    const shown: Array<{readonly body: string; readonly title: string}> = [];
    const {errorSpy, logSpy, notify} = await loadNotify(shown, 'notification_log_unit');
    const error = Object.assign(new Error(`EACCES: permission denied, open '${USER_PATH}'`), {code: 'EACCES'});

    notify(`Could not run ${COMMAND_ID}`, `Check ${USER_PATH}`, {error});

    // The user still sees the actionable text.
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({body: `Check ${USER_PATH}`, title: `Could not run ${COMMAND_ID}`});
    // The log carries neither the text nor the raw error.
    const logged = JSON.stringify([logSpy.mock.calls, errorSpy.mock.calls]);
    expect(logged).not.toContain(COMMAND_ID);
    expect(logged).not.toContain(USER_PATH);
    expect(logSpy).toHaveBeenCalledWith('[Notification] Notification shown.');
    expect(errorSpy).toHaveBeenCalledWith('[Notification]', {error: {code: 'EACCES', name: 'Error'}});
  });

  test('drops an errno-shaped secret through the production path', async () => {
    const shown: Array<{readonly body: string; readonly title: string}> = [];
    const {errorSpy, logSpy, notify} = await loadNotify(shown, 'notification_log_unit_token');
    const error = Object.assign(new Error(`could not use ${SENSITIVE_TOKEN}`), {
      code: SENSITIVE_TOKEN,
      name: SENSITIVE_TOKEN
    });

    notify(`Could not run ${COMMAND_ID}`, `Check ${USER_PATH}`, {error});

    expect(shown).toHaveLength(1);
    const logged = JSON.stringify([logSpy.mock.calls, errorSpy.mock.calls]);
    expect(logged).not.toContain(SENSITIVE_TOKEN);
    expect(logged).not.toContain(COMMAND_ID);
    expect(logged).not.toContain(USER_PATH);
    expect(errorSpy).toHaveBeenCalledWith('[Notification]', {error: {name: 'Error'}});
  });
});
