/* eslint no-new:0 */
/** Logs and shows a desktop notification, also logging `details.error` when present. */
export default function notify(title: string, body: string, details: {error?: any} = {}) {
  console.log(`[Notification] ${title}: ${body}`);
  if (details.error) {
    console.error(details.error);
  }
  new Notification(title, {body});
}
