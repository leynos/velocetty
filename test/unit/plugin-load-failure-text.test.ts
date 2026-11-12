/** @file Verifies plugin load failure text carries no path and no raw message. */
import {expect, test} from 'bun:test';

import {pluginLoadFailureText} from '../../app/utils/plugin-failure';

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
