import {NOTIFICATION_MESSAGE, NOTIFICATION_DISMISS} from '@shared/constants/notifications';
import type {HyperActions} from '../../typings/hyper';
import type {AddNotificationParams} from '../bootstrap/renderer-bootstrap';

/** Requests removal of the notification identified by `id`. */
export function dismissNotification(id: string): HyperActions {
  return {
    type: NOTIFICATION_DISMISS,
    id
  };
}

/** Requests that a new notification message be shown to the user. */
export function addNotificationMessage({text, url = null, dismissable = true}: AddNotificationParams): HyperActions {
  return {
    type: NOTIFICATION_MESSAGE,
    text,
    url,
    dismissable
  };
}
