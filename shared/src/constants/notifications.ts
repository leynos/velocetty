/** @file Shared notification action constants and action contracts. */
/** Action type constant for posting a notification. */
export const NOTIFICATION_MESSAGE = 'NOTIFICATION_MESSAGE';
/** Action type constant for dismissing a notification. */
export const NOTIFICATION_DISMISS = 'NOTIFICATION_DISMISS';

/** Action contract for notification enqueue events. */
export interface NotificationMessageAction {
  readonly type: typeof NOTIFICATION_MESSAGE;
  readonly text: string;
  readonly url: string | null;
  readonly dismissable: boolean;
}

/** Action contract for notification dismiss events. */
export interface NotificationDismissAction {
  readonly type: typeof NOTIFICATION_DISMISS;
  readonly id: string;
}

/** Union type for notification actions. */
export type NotificationActions = NotificationMessageAction | NotificationDismissAction;
