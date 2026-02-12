/** @file Shared notification action constants and action contracts. */
export const NOTIFICATION_MESSAGE = 'NOTIFICATION_MESSAGE';
export const NOTIFICATION_DISMISS = 'NOTIFICATION_DISMISS';

export interface NotificationMessageAction {
  type: typeof NOTIFICATION_MESSAGE;
  readonly text: string;
  readonly url: string | null;
  readonly dismissable: boolean;
}

export interface NotificationDismissAction {
  type: typeof NOTIFICATION_DISMISS;
  readonly id: string;
}

export type NotificationActions = NotificationMessageAction | NotificationDismissAction;
