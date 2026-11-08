/** @file Bounded log records for the shared notification sink. */
/*
 * The notification sink is shared by every feature, so it cannot print the
 * title or body it was given: a diagnostic can name a command the user wrote
 * and a notice can name a path. The log keeps a fixed marker plus the error's
 * bounded description, while the notification itself carries the full text.
 */
import {describeError} from './error-code';

/** The sinks the notification log writes to; injectable so a test can capture them. */
export type NotificationLogSinks = Readonly<{
  readonly error: (...args: unknown[]) => void;
  readonly info: (line: string) => void;
}>;

const consoleSinks: NotificationLogSinks = {
  error: (...args) => console.error(...args),
  info: (line) => console.log(line)
};

/**
 * Records that a notification was shown, without its title or body.
 *
 * Both are user-facing text and may carry a command identifier or a path. A
 * developer can still see that a notification appeared and, when the caller
 * supplied one, which failure it reported.
 *
 * @example
 * ```ts
 * const lines: string[] = [];
 * logNotificationShown(
 *   {error: Object.assign(new Error('ENOENT: /home/ada'), {code: 'ENOENT'})},
 *   {error: (...args) => lines.push(JSON.stringify(args)), info: (line) => lines.push(line)}
 * );
 * lines[0]; // '[Notification] Notification shown.'
 * ```
 */
export const logNotificationShown = (
  details: {readonly error?: unknown} = {},
  sinks: NotificationLogSinks = consoleSinks
): void => {
  sinks.info('[Notification] Notification shown.');
  if (details.error) {
    sinks.error('[Notification]', describeError(details.error));
  }
};
