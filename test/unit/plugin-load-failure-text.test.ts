/** @file Verifies plugin load failure text carries no path and no raw message. */
import {expect, test} from 'bun:test';

import {
  pluginFailureLogText,
  pluginLoadedText,
  pluginLoadFailureText,
  pluginMetadataWarning
} from '../../app/utils/plugin-failure';

/**
 * An error whose message quotes the plugin's path, as a load failure can.
 *
 * @param code - The code to attach, which may be a path rather than an errno.
 * @returns The error a load would throw.
 */
const pathQuotingError = (code?: string) =>
  Object.assign(
    new Error('ENOENT: open /home/ada/.hyper_plugins/hyper-cwd/index.js'),
    code === undefined ? {} : {code}
  );

test('a known errno code is reported and neither path nor message is', () => {
  const text = pluginLoadFailureText('hyper-cwd', pathQuotingError('ENOENT'));

  expect(text).toBe('Plugin "hyper-cwd" failed to load (ENOENT).');
  expect(text).not.toContain('/home/ada');
  expect(text).not.toContain('open ');
});

test('a code that is not an errno is dropped rather than echoed', () => {
  // An unrecognized code is just another string, so it could quote the path
  // the same way the message does.
  const text = pluginLoadFailureText('hyper-cwd', pathQuotingError('/home/ada/.hyper_plugins/hyper-cwd'));

  expect(text).toBe('Plugin "hyper-cwd" failed to load.');
  expect(text).not.toContain('/home/ada');
});

test('a thrown value that is not an error is described without its text', () => {
  expect(pluginLoadFailureText('hyper-cwd', 'boom: /home/ada/.hyper_plugins/hyper-cwd')).toBe(
    'Plugin "hyper-cwd" failed to load.'
  );
});

test('a console line numbers the plugin instead of repeating its name', () => {
  // The directory name comes from the user's configuration, so it is text a
  // log must not carry; the position in the configured list still points at the
  // entry to fix.
  const text = pluginFailureLogText(2, pathQuotingError('ENOENT'));

  expect(text).toBe('Plugin 2 failed to load (ENOENT).');
  expect(text).not.toContain('/home/ada');
  expect(text).not.toContain('hyper-cwd');
});

test('a console line drops an unbounded code as well as the name', () => {
  const text = pluginFailureLogText(2, pathQuotingError('/home/ada/.hyper_plugins/hyper-cwd'));

  expect(text).toBe('Plugin 2 failed to load.');
  expect(text).not.toContain('/home/ada');
});

test('a missing package.json is reported by position, not by directory', () => {
  const text = pluginMetadataWarning(3);

  expect(text).toBe('No package.json found for plugin 3.');
  expect(text).not.toContain('/');
});

test('a successful load is reported by position, not by name or version', () => {
  const text = pluginLoadedText(2);

  expect(text).toBe('Plugin 2 loaded.');
  expect(text).not.toContain('/');
  expect(text).not.toContain('hyper-cwd');
});
