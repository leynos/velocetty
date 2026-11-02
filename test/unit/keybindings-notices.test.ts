/** @file Verifies each keybindings notice fires at most once, and never on empty input. */
import {expect, test} from 'bun:test';

import {createKeybindingsNotices} from '../../app/config/import-keybindings';

/** One notification as the user would receive it. */
type Notice = {readonly title: string; readonly body?: string};

/** The notices bound to a sink that keeps what was sent. */
const createRecorder = () => {
  const sent: Notice[] = [];
  const notices = createKeybindingsNotices((title, body) => {
    // `exactOptionalPropertyTypes` forbids storing an absent body as undefined.
    sent.push(body === undefined ? {title} : {body, title});
  });
  return {notices, sent};
};

const diagnostic = {message: 'bad shortcut', path: '/keymaps', suggestedFix: 'Fix the shortcut'};

test('each notice fires once no matter how many reloads ask for it', () => {
  const {notices, sent} = createRecorder();

  for (let reload = 0; reload < 3; reload += 1) {
    notices.announceDeferred([diagnostic]);
    notices.announceLegacyIgnored();
    notices.announceSeeded();
    notices.announceShadowed(['/home/user/.hyper/config.json5']);
  }

  // Three reloads would otherwise repeat the same four notices nine times.
  const titles = sent.map(({title}) => title);
  expect(titles).toHaveLength(4);
  // The deferred notice appends the diagnostics, so only its opening is fixed.
  expect(titles[0] ?? '').toStartWith("Couldn't move shortcuts to keybindings.json5.");
  expect(titles.slice(1)).toEqual([
    'Shortcuts in config.json5 are ignored',
    'Shortcuts moved to keybindings.json5',
    'Using the active configuration'
  ]);
});

test('an empty input says nothing and does not consume the notice', () => {
  const {notices, sent} = createRecorder();

  // Nothing to report, so nothing is sent, but the first real call still works.
  notices.announceDeferred([]);
  notices.announceShadowed([]);
  expect(sent).toEqual([]);

  notices.announceDeferred([diagnostic]);
  notices.announceShadowed(['/home/user/.hyper/config.json5']);
  expect(sent.map(({title}) => title)).toEqual([
    "Couldn't move shortcuts to keybindings.json5. Fix the keymaps in config.json5 to migrate them. " +
      '/keymaps: bad shortcut Suggested fix: Fix the shortcut.',
    'Using the active configuration'
  ]);
});

test('the shadowed notice stays accurate when development mode hides Velocetty', () => {
  const {notices, sent} = createRecorder();

  // Development mode outranks the Velocetty tree, so the notice must not
  // claim the Velocetty copy is the one in use.
  notices.announceShadowed(['/home/user/.config/Velocetty/config.json5']);

  expect(sent).toEqual([
    {
      body: 'Ignoring the lower-priority copy at /home/user/.config/Velocetty/config.json5.',
      title: 'Using the active configuration'
    }
  ]);
});

test('the shadowed notice names every hidden copy', () => {
  const {notices, sent} = createRecorder();

  notices.announceShadowed(['/home/user/.hyper/config.json5', '/etc/velocetty/config.json5']);

  // The whole notice is fixed, so a lost path or a changed sentence fails here.
  expect(sent).toEqual([
    {
      body: 'Ignoring the lower-priority copy at /home/user/.hyper/config.json5, /etc/velocetty/config.json5.',
      title: 'Using the active configuration'
    }
  ]);
});
