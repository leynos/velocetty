/** @file The app's single entry point for showing a desktop notification. */
/*
 * Callers pass user-facing text and, when a failure is being reported, bounded
 * context for the log. The notification itself carries the full text; the log
 * line records that it appeared plus the operation, category, and bounded error
 * description, so a command identifier or a path cannot reach the log.
 */
import {app, Notification} from 'electron';

import {icon} from './config/paths';
import {logNotificationShown, type NotificationDetails} from './utils/notification-log';

/**
 * Shows a desktop notification, or defers it until Electron is ready.
 *
 * Electron refuses to create a `Notification` before the app is ready, so an
 * early call is queued on the `ready` event instead of being dropped.
 *
 * @param title - The notification title.
 * @param body - The message body; empty when the title says enough.
 * @param details - Bounded log context, including an error to describe.
 */
export default function notify(title: string, body = '', details: NotificationDetails = {}) {
  logNotificationShown(details);
  if (app.isReady()) {
    _createNotification(title, body);
  } else {
    app.on('ready', () => {
      _createNotification(title, body);
    });
  }
}

const _createNotification = (title: string, body: string) => {
  new Notification({title, body, ...(process.platform === 'linux' && {icon})}).show();
};
