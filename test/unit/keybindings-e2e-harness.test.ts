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
 */
const createFakeApp = (verdictFor: (ordinal: number) => ProbeVerdict) => {
  let commandRuns = 0;
  let ordinalsSent = 0;
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
    stop: async () => {},
    waitFor: async ({matcher}: Readonly<{matcher: RegExp}>): Promise<string> => {
      const ordinal = ordinalOf(matcher);
      // A reply from an earlier press of the same chord, which a chord-only
      // wait would have accepted for this one.
      if (matcher.test('[e2e] shortcut-probe pressed #0 ctrl+n')) {
        throw new Error('The wait accepted a reply that names another request.');
      }
      const verdict = verdictFor(ordinal);
      if (verdict === 'unanswered' || !matcher.test(`[e2e] shortcut-probe ${verdict} #${ordinal} ctrl+n`)) {
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

  expect(await rejectionMessage(pressAndAwaitProbe({app, shortcuts: ['ctrl+n']}))).toMatch(/was rejected/);
});

test('a stale reply for an earlier press cannot satisfy the wait', async () => {
  // Nothing answers the new request, yet a line for the same chord already
  // exists from an earlier press; only the ordinal keeps the two apart.
  const app = createFakeApp(() => 'unanswered');

  expect(await rejectionMessage(pressAndAwaitProbe({app, shortcuts: ['ctrl+n']}))).toMatch(/was unanswered/);
});

test('pressing until a command runs retries an unanswered press', async () => {
  const app = createFakeApp((ordinal) => (ordinal === 1 ? 'unanswered' : 'pressed'));

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toBeNull();
});

test('pressing until a command runs reports the last verdict when no press works', async () => {
  const app = createFakeApp(() => 'rejected');

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toMatch(
    /last press rejected/
  );
});
