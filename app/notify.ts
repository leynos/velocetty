import {app, Notification} from 'electron';

import {icon} from './config/paths';
import {errorCode} from './utils/error-code';

/**
 * A bounded description of a thrown value, for the shared log line.
 *
 * The notification sink is shared by every feature, so it must not print an
 * arbitrary error: a message can carry a path, a command identifier, or a
 * fragment of the user's file. The code and the constructor name are fixed
 * tokens that still tell a developer which failure occurred; the user-facing
 * notification body carries the actionable text.
 */
const describeError = (error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code = errorCode(error);

  return code === undefined ? {name} : {code, name};
};

export default function notify(title: string, body = '', details: {error?: unknown} = {}) {
  console.log(`[Notification] ${title}: ${body}`);
  if (details.error) {
    console.error('[Notification]', describeError(details.error));
  }
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
