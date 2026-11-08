/** @file The notifier keeps user-authored content out of structured logs. */
/*
 * A diagnostic path repeats the command identifier the user wrote, and its
 * message can quote the file. The notification is where that content belongs;
 * the structured log must stay bounded so it can be shared safely.
 */
import {expect, test} from 'bun:test';

import type {configValidationDiagnostic} from '@shared/types/config';

import {createKeybindingsNotifier} from '../../app/config/keybindings-notifier';

const SOURCE = 'keybindings.json5';

/** Collects the notification and warning sinks so a test can inspect both. */
const createSinks = () => {
  const notices: string[] = [];
  const warnings: unknown[][] = [];
  const warn = (...args: Parameters<typeof console.warn>): void => {
    warnings.push(args);
  };
  const report = createKeybindingsNotifier((title) => notices.push(title), warn);
  return {notices, report, warnings};
};

const diagnostic = (path: string, message: string): configValidationDiagnostic => ({
  message,
  path,
  suggestedFix: 'Rename the command.'
});

test('the diagnostics log carries a count and closed categories, not the diagnostics', () => {
  const {report, warnings} = createSinks();
  const commandId = 'window:new';

  report({
    diagnostics: [
      diagnostic(`/${commandId}`, `Invalid command identifier "${commandId}".`),
      diagnostic('/$schema', 'Expected the $schema key to hold a non-empty string.')
    ],
    kind: 'diagnostics',
    label: SOURCE
  });

  expect(warnings).toHaveLength(1);
  const [message, payload] = warnings[0] ?? [];
  expect(message).toBe('[config-keybindings] User keybindings diagnostics.');
  expect(payload).toEqual({count: 2, kinds: ['command', 'schema-key'], source: SOURCE});

  // Neither the command identifier nor a path may survive into the log.
  const serialized = JSON.stringify(warnings);
  expect(serialized).not.toContain(commandId);
  expect(serialized).not.toContain('/$schema');
});

test('a document-level diagnostic is logged as the document category', () => {
  const {report, warnings} = createSinks();

  report({diagnostics: [diagnostic(SOURCE, 'Expected a JSON5 object.')], kind: 'diagnostics', label: SOURCE});

  expect(warnings[0]?.[1]).toEqual({count: 1, kinds: ['document'], source: SOURCE});
});

test('a positioned syntax error is a document diagnostic, not a command', () => {
  const {report, warnings} = createSinks();

  // A JSON5 syntax error carries `label:line:column`, which is still the
  // document itself rather than a command identifier.
  report({
    diagnostics: [diagnostic(`${SOURCE}:1:15`, 'Unexpected token.')],
    kind: 'diagnostics',
    label: SOURCE
  });

  expect(warnings[0]?.[1]).toEqual({count: 1, kinds: ['document'], source: SOURCE});
  expect(JSON.stringify(warnings)).not.toContain('1:15');
});

test('the user-facing notification still names the problem', () => {
  const {notices, report, warnings} = createSinks();

  report({
    basis: 'last-known-good',
    diagnostics: [diagnostic('/window:new', 'Expected a shortcut string.')],
    kind: 'invalid-file'
  });

  // The notification is the intended surface for the detail, and the log stays
  // silent for this notice because none is written for it.
  expect(notices[0]).toContain('/window:new');
  expect(warnings).toEqual([]);
});
