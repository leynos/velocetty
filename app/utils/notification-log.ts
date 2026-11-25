/** @file Bounded log records for the shared notification sink. */
/*
 * The notification sink is shared by every feature, so it cannot print the
 * title or body it was given: a diagnostic can name a command the user wrote
 * and a notice can name a path. The log keeps a fixed marker plus a bounded
 * record of the operation, the failure category, and the error's description,
 * while the notification itself carries the full text.
 */
import {describeError} from './error-code';

/** The operations a notification may report a failure for. */
export type NotificationOperation = 'plugin-decoration' | 'plugin-hook' | 'plugin-load' | 'plugin-settings' | 'startup';

/** The ways a reported operation may have failed. */
export type NotificationCategory = 'invalid-return' | 'thrown';

/** Extra bounded context a caller may attach to a notification's log record. */
export type NotificationDetails = Readonly<{
  readonly error?: unknown;
  readonly operation?: NotificationOperation;
  readonly category?: NotificationCategory;
}>;

/** The sinks the notification log writes to; injectable so a test can capture them. */
export type NotificationLogSinks = Readonly<{
  readonly error: (...args: unknown[]) => void;
  readonly info: (line: string) => void;
}>;

const consoleSinks: NotificationLogSinks = {
  error: (...args) => console.error(...args),
  info: (line) => console.log(line)
};

/** The bounded record a notification's log line may carry. */
type NotificationRecord = {
  category?: NotificationCategory;
  error?: ReturnType<typeof describeError>;
  operation?: NotificationOperation;
};

/**
 * Builds the bounded record for a notification that carried context.
 *
 * Only fixed tokens and the error's bounded description are copied, so a
 * crafted string cannot reach the log through any field. Each field is added
 * only when the caller supplied it, so an omitted one is absent from the line
 * rather than present and empty.
 */
const boundedRecord = (details: NotificationDetails): NotificationRecord => {
  const record: NotificationRecord = {};
  if (details.operation !== undefined) {
    record.operation = details.operation;
  }
  if (details.category !== undefined) {
    record.category = details.category;
  }
  if (details.error !== undefined) {
    record.error = describeError(details.error);
  }
  return record;
};

/**
 * Records that a notification was shown, without its title or body.
 *
 * Both are user-facing text and may carry a command identifier or a path. A
 * developer can still see that a notification appeared and, when the caller
 * supplied one, which operation failed and in what way.
 *
 * @param details - The bounded context the caller attached, if any.
 * @param sinks - The sinks to write to; defaults to the console.
 *
 * @example
 * ```ts
 * const lines: string[] = [];
 * logNotificationShown(
 *   {error: Object.assign(new Error('ENOENT: /home/ada'), {code: 'ENOENT'}), operation: 'plugin-load'},
 *   {error: (...args) => lines.push(JSON.stringify(args)), info: (line) => lines.push(line)}
 * );
 * lines[0]; // '[Notification] Notification shown.'
 * ```
 */
export const logNotificationShown = (
  details: NotificationDetails = {},
  sinks: NotificationLogSinks = consoleSinks
): void => {
  sinks.info('[Notification] Notification shown.');
  const record = boundedRecord(details);
  if (Object.keys(record).length > 0) {
    sinks.error('[Notification]', record);
  }
};
