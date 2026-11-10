/** @file Verifies the keybindings E2E harness attributes each probe reply to its own request. */
/*
 * The Electron lane drives presses through a request file, so a test can only
 * trust a negative assertion when the reply it waited for belongs to the press
 * it just sent. These tests model the probe's replies, including stale replies
 * for earlier presses of the same chord, without launching Electron.
 */
import {expect, test} from 'bun:test';

import {pressUntilExecuted, pressWithoutCommand} from '../e2e/keybindings-e2e-harness';

/** The verdicts a scripted probe can report for a request. */
type ProbeVerdict = 'pressed' | 'unbound' | 'rejected' | 'failed' | 'unanswered';

/** Extracts the request ordinal a harness wait is looking for. */
const ordinalOf = (matcher: RegExp): number => {
  const match = /#(\d+) /.exec(matcher.source);
  if (match?.[1] === undefined) {
    throw new Error(`The wait does not name a request: ${matcher.source}`);
  }
  return Number(match[1]);
};

/** The line a scripted probe prints for a request it answered, newline included. */
const scriptedReply = (ordinal: number, verdict: ProbeVerdict, command: string): string =>
  verdict === 'pressed'
    ? `[e2e] shortcut-probe pressed #${ordinal} ctrl+n command=${command}\n`
    : `[e2e] shortcut-probe ${verdict} #${ordinal} ctrl+n\n`;

/** The reply an earlier press of the same chord leaves in the output. */
const earlierReply = '[e2e] shortcut-probe pressed #0 ctrl+n command=window:new';

/** The error a scripted wait throws when the probe has no reply for it. */
const timedOut = (ordinal: number) => new Error(`Timed out waiting for the probe's reply to request #${ordinal}.`);

/** Records one wait on a request, so a reply can be withheld from the first. */
const countWait = (waitsByOrdinal: Map<number, number>, ordinal: number): number => {
  const waits = (waitsByOrdinal.get(ordinal) ?? 0) + 1;
  waitsByOrdinal.set(ordinal, waits);
  return waits;
};

/** Whether the probe is still on its way to this request, so the first wait misses it. */
const isWithheldReply = (lateReplies: ReadonlySet<number>, ordinal: number, waits: number): boolean =>
  lateReplies.has(ordinal) && waits === 1;

/**
 * The line a scripted probe gives in answer to one wait.
 *
 * A verdict of `unanswered`, or a reply the probe has not reached yet, times
 * out instead; the caller's own `matcher` check then decides whether the reply
 * names the request it asked about.
 */
const answerWait = (
  wait: Readonly<{
    ordinal: number;
    waits: number;
    verdict: ProbeVerdict;
    command: string;
    lateReplies: ReadonlySet<number>;
  }>
): string => {
  if (wait.verdict === 'unanswered') {
    throw timedOut(wait.ordinal);
  }
  if (isWithheldReply(wait.lateReplies, wait.ordinal, wait.waits)) {
    throw timedOut(wait.ordinal);
  }
  return scriptedReply(wait.ordinal, wait.verdict, wait.command);
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
 *
 * `command` is the command the scripted probe attributes to each `pressed`
 * reply, so a test can model a press that ran some other binding's command.
 * `markersBefore` seeds the output with command markers an earlier press left.
 */
const createFakeApp = (
  verdictFor: (ordinal: number) => ProbeVerdict,
  lateReplies: ReadonlySet<number> = new Set(),
  command = 'window:new',
  markersBefore = 0
) => {
  let commandRuns = markersBefore;
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
      const waits = countWait(waitsByOrdinal, ordinal);
      // A reply from an earlier press of the same chord, which a chord-only
      // wait would have accepted for this one.
      if (matcher.test(earlierReply)) {
        throw new Error('The wait accepted a reply that names another request.');
      }
      const reply = answerWait({ordinal, waits, verdict: verdictFor(ordinal), command, lateReplies});
      if (!matcher.test(reply)) {
        throw timedOut(ordinal);
      }
      return reply;
    }
  };
  return app;
};

/** Test budget for a helper that spends its whole retry pause budget. */
const pressRetryBudgetMs = 20_000;

/** Runs a promise and reports its rejection message, or `null` when it resolved. */
const rejectionMessage = async (promise: Promise<unknown>): Promise<string | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

test(
  'a rejected press fails instead of standing in for a handled one',
  async () => {
    const app = createFakeApp(() => 'rejected');

    expect(await rejectionMessage(pressWithoutCommand({app, shortcuts: ['ctrl+n']}))).toMatch(
      /could not be pressed \(rejected\)/
    );
  },
  // The helper spends its whole retry budget on rejected presses.
  pressRetryBudgetMs
);

test('a press rejected by a window that is still loading is retried', async () => {
  // `window:new` starts a window with no body to press on yet, so the probe
  // rejects the first request. Repeating it reaches the loaded page, where the
  // chord runs no command.
  const app = createFakeApp((ordinal) => (ordinal === 1 ? 'rejected' : 'unbound'));

  expect(await rejectionMessage(pressWithoutCommand({app, shortcuts: ['ctrl+n']}))).toBeNull();
});

test('a chord that still runs a command fails the negative assertion', async () => {
  // The probe saw the press itself emit the command, so the binding is not gone
  // however the marker count looks, and the message names what still ran.
  const app = createFakeApp(() => 'pressed');

  expect(await rejectionMessage(pressWithoutCommand({app, shortcuts: ['ctrl+n']}))).toMatch(/still ran window:new/);
});

test('a press that ran another command fails instead of satisfying the expected one', async () => {
  // The press emitted the command of a different binding, so the shortcut under
  // test did not run it. Accepting any command would let a stale binding stand
  // in for the one the scenario meant to exercise.
  const app = createFakeApp(() => 'pressed', new Set(), 'window:close');

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toMatch(
    /ran window:close, not window:new/
  );
  expect(app.sent()).toBe(1);
});

test('a stale reply for an earlier press cannot satisfy the wait', async () => {
  // Nothing answers the new request, yet a line for the same chord already
  // exists from an earlier press; only the ordinal keeps the two apart.
  const app = createFakeApp(() => 'unanswered');

  expect(await rejectionMessage(pressWithoutCommand({app, shortcuts: ['ctrl+n']}))).toMatch(
    /never answered request #1/
  );
});

test(
  'a command an earlier press left behind cannot satisfy the new shortcut',
  async () => {
    // The old binding ran its command before the file was replaced, so the
    // captured output already holds its marker. The new chord's own press emits
    // nothing, so the harness must fail: that marker proves some press ran the
    // command, not that this one did.
    const app = createFakeApp(() => 'unbound', new Set(), 'window:new', 1);

    expect(app.count()).toBe(1);
    expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toMatch(
      /never executed window:new/
    );
  },
  pressRetryBudgetMs
);

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
  const app = createFakeApp(() => 'unbound', new Set([1]));

  expect(await rejectionMessage(pressWithoutCommand({app, shortcuts: ['ctrl+n']}))).toBeNull();
  expect(app.sent()).toBe(1);
});

test('a press that runs no command is retried until the command follows', async () => {
  // The chord was pressed before the renderer bound its listeners, so the first
  // attempt reports `unbound`. Repeating it is safe because nothing ran.
  const app = createFakeApp((ordinal) => (ordinal === 1 ? 'unbound' : 'pressed'));

  expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toBeNull();
  expect(app.sent()).toBe(2);
});

test(
  'pressing until a command runs reports the last verdict when no press works',
  async () => {
    const app = createFakeApp(() => 'rejected');

    expect(await rejectionMessage(pressUntilExecuted({app, command: 'window:new', shortcut: 'ctrl+n'}))).toMatch(
      /last press rejected/
    );
  },
  pressRetryBudgetMs
);
