/** @file Verifies the keybindings E2E harness attributes each probe reply to its own request. */
/*
 * The Electron lane drives presses through a request file, so a test can only
 * trust a negative assertion when the reply it waited for belongs to the press
 * it just sent. These tests model the probe's replies, including stale replies
 * for earlier presses of the same chord, without launching Electron.
 */
import {expect, test} from 'bun:test';

import {pressAndAwaitProbe, pressUntilExecuted} from '../e2e/keybindings-e2e-harness';

/** The verdicts a scripted probe can report for a request. */
type ProbeVerdict = 'pressed' | 'rejected' | 'failed' | 'unanswered';

/** Extracts the request ordinal a harness wait is looking for. */
const ordinalOf = (matcher: RegExp): number => {
  const match = /#(\d+) /.exec(matcher.source);
  if (match?.[1] === undefined) {
    throw new Error(`The wait does not name a request: ${matcher.source}`);
  }
  return Number(match[1]);
};

/**
 * A launched-app stand-in whose probe verdicts come from a script.
 *
 * `send` mirrors the real launcher by attaching an ordinal to each request, and
 * `waitFor` only answers a wait that names that request. `count` reports the
 * command markers the script says the presses produced.
 *
 * An ordinal in `lateReplies` models a probe that reaches the request only after
 * the harness's first, shorter wait has expired: that wait times out, and the
 * next wait on the same request is answered.
 */
const createFakeApp = (verdictFor: (ordinal: number) => ProbeVerdict, lateReplies: ReadonlySet<number> = new Set()) => {
  let commandRuns = 0;
  let ordinalsSent = 0;
  const waitsByOrdinal = new Map<number, number>();
  const app = {
    count: () => commandRuns,
    output: () => '',
    send: () => {
      ordinalsSent += 1;
      const verdict = verdictFor(ordinalsSent);
      if (verdict === 'pressed') {
        commandRuns += 1;
      }
      return ordinalsSent;
    },
    /** How many requests the harness appended, so a repeat can be detected. */
    sent: () => ordinalsSent,
    stop: async () => {},
    waitFor: async ({matcher}: Readonly<{matcher: RegExp}>): Promise<string> => {
      const ordinal = ordinalOf(matcher);
      const waits = (waitsByOrdinal.get(ordinal) ?? 0) + 1;
      waitsByOrdinal.set(ordinal, waits);
      // A reply from an earlier press of the same chord, which a chord-only
      // wait would have accepted for this one.
      if (matcher.test('[e2e] shortcut-probe pressed #0 ctrl+n')) {
        throw new Error('The wait accepted a reply that names another request.');
      }
      const verdict = verdictFor(ordinal);
      const isLate = lateReplies.has(ordinal) && waits === 1;
      if (verdict === 'unanswered' || isLate || !matcher.test(`[e2e] shortcut-probe ${verdict} #${ordinal} ctrl+n`)) {
        throw new Error(`Timed out waiting for the probe's reply to request #${ordinal}.`);
      }
      return `[e2e] shortcut-probe ${verdict} #${ordinal} ctrl+n`;
    }
  };
  return app;
};

/** Runs a promise and reports its rejection message, or `null` when it resolved. */
const rejectionMessage = async (promise: Promise<unknown>): Promise<string | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

test('a rejected press fails instead of standing in for a handled one', async () => {
  const app = createFakeApp(() => 'rejected');

  expect(await rejectionMessage(pressAndAwaitProbe({app, shortcuts: ['ctrl+n']}))).toMatch(/last press rejected/);
});

test('a press rejected by a window that is still loading is retried', async () => {
  // `window:new` starts a window with no body to press on yet, so the probe
  // rejects the first request. Repeating it reaches the loaded page.
  const app = createFakeApp((ordinal) => (ordinal === 1 ? 'rejected' : 'pressed'));

  expect(await rejectionMessage(pressAndAwaitProbe({app, shortcuts: ['ctrl+n']}))).toBeNull();
});

test('a stale reply for an earlier press cannot satisfy the wait', async () => {
  // Nothing answers the new request, yet a line for the same chord already
  // exists from an earlier press; only the ordinal keeps the two apart.
  const app = createFakeApp(() => 'unanswered');

  expect(await rejectionMessage(pressAndAwaitProbe({app, shortcuts: ['ctrl+n']}))).toMatch(/never answered request #1/);
});

test('a press the probe never answers fails instead of being repeated', async () => {
  // The request stays in the probe's file, so sending another would press the
  // chord twice once the probe caught up with both.
  const app = createFakeApp(() => 'unanswered');

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toMatch(
    /never answered request #1/
  );
  expect(app.sent()).toBe(1);
});

test('a press the probe answers after the retry interval is waited for, not repeated', async () => {
  // The probe reaches request #1 only after the harness's short wait has
  // expired. Waiting for that same request is the only way to press once.
  const app = createFakeApp(() => 'pressed', new Set([1]));

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toBeNull();
  expect(app.sent()).toBe(1);
});

test('a press of a chord that must not run is also waited for, not repeated', async () => {
  // The negative assertion after this helper rests on exactly one press of the
  // old chord, so a slow reply must extend the wait rather than add a press.
  const app = createFakeApp(() => 'pressed', new Set([1]));

  expect(await rejectionMessage(pressAndAwaitProbe({app, shortcuts: ['ctrl+n']}))).toBeNull();
  expect(app.sent()).toBe(1);
});

test('pressing until a command runs reports the last verdict when no press works', async () => {
  const app = createFakeApp(() => 'rejected');

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toMatch(
    /last press rejected/
  );
});
