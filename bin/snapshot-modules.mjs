/** @file Package entrypoints linked into the Electron V8 startup snapshot. */
export const snapshotRuntimeModules = [
  'color-convert',
  'color-string',
  'columnify',
  'lodash',
  'ms',
  'normalize-url',
  'parse-url',
  'php-escape-shell',
  'redux-thunk',
  'redux',
  'reselect',
  'seamless-immutable',
  'stylis',
  'xterm-addon-unicode11'
];

export const snapshotOptionalModules = [
  'args',
  'mousetrap',
  'open',
  'react-dom',
  'react-redux',
  'react',
  'xterm-addon-fit',
  'xterm-addon-image',
  'xterm-addon-search',
  'xterm-addon-web-links',
  'xterm-addon-webgl',
  'xterm-addon-canvas',
  'xterm'
];
