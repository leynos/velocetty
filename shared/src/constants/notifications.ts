/** @file Shared notification action constants and action contracts. */
/** Action type constant for posting a notification. */
export const NOTIFICATION_MESSAGE = 'NOTIFICATION_MESSAGE';
/** Action type constant for dismissing a notification. */
export const NOTIFICATION_DISMISS = 'NOTIFICATION_DISMISS';

/** Action contract for notification enqueue events. */
export interface NotificationMessageAction {
  /** Discriminates this action as `NOTIFICATION_MESSAGE`. */
  readonly type: typeof NOTIFICATION_MESSAGE;
  /** Notification body text. */
  readonly text: string;
  /** Optional link opened when the notification is activated. */
  readonly url: string | null;
  /** Whether the user can dismiss the notification manually. */
  readonly dismissable: boolean;
}

/** Action contract for notification dismiss events. */
export interface NotificationDismissAction {
  /** Discriminates this action as `NOTIFICATION_DISMISS`. */
  readonly type: typeof NOTIFICATION_DISMISS;
  /** Identifier of the notification to dismiss. */
  readonly id: string;
}

/** Union type for notification actions. */
export type NotificationActions = NotificationMessageAction | NotificationDismissAction;
