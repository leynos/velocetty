import {NOTIFICATION_MESSAGE, NOTIFICATION_DISMISS} from '@shared/constants/notifications';
import type {HyperActions} from '../../typings/hyper';
import type {AddNotificationParams} from '../bootstrap/renderer-bootstrap';

export function dismissNotification(id: string): HyperActions {
  return {
    type: NOTIFICATION_DISMISS,
    id
  };
}

export function addNotificationMessage({text, url = null, dismissable = true}: AddNotificationParams): HyperActions {
  return {
    type: NOTIFICATION_MESSAGE,
    text,
    url,
    dismissable
  };
}
