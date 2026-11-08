import {app, Notification} from 'electron';

import {icon} from './config/paths';
import {logNotificationShown} from './utils/notification-log';

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
