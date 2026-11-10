import {app, Notification} from 'electron';

import {icon} from './config/paths';
import {logNotificationShown} from './utils/notification-log';

/**
 * Shows a desktop notification, or defers it until Electron is ready.
 *
 * Electron refuses to create a `Notification` before the app is ready, so an
 * early call is queued on the `ready` event instead of being dropped.
 *
 * @param title - The notification title.
 * @param body - The message body; empty when the title says enough.
 * @param details - Extra context, including an error to record in the log.
 */
export default function notify(title: string, body = '', details: {error?: unknown} = {}) {
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
