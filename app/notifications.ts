import type {BrowserWindow} from 'electron';

import fetch from 'electron-fetch';
import ms from 'ms';
import {z} from 'zod';

import {version} from './package.json';

const NEWS_URL = 'https://hyper-news.now.sh';
const notificationSchema = z.object({text: z.string(), url: z.string(), dismissable: z.boolean()}).loose();
const notificationMessageSchema = z.union([z.literal(''), notificationSchema]);

export default function fetchNotifications(win: BrowserWindow) {
  const {rpc} = win;
  const retry = (err?: Error) => {
    setTimeout(() => fetchNotifications(win), ms('30m'));
    if (err) {
      console.error('Notification messages fetch error', err.stack);
    }
  };
  console.log('Checking for notification messages');
  fetch(NEWS_URL, {
    headers: {
      'X-Hyper-Version': version,
      'X-Hyper-Platform': process.platform
    }
  })
    .then((res) => res.json())
    .then((data) => {
      const message = notificationMessageSchema.parse(data.message || '');
      if (message === '') {
        console.log('No matching notification messages');
      } else {
        rpc.emit('add notification', message);
      }

      retry();
    })
    .catch(retry);
}
