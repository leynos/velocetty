/** @file Shared constants for esbuild migration pipeline. */

export const rendererExternalRequireMap = {
  'color-convert': './node_modules/color-convert/index.js',
  'color-string': './node_modules/color-string/index.js',
  columnify: './node_modules/columnify/columnify.js',
  lodash: './node_modules/lodash/lodash.js',
  ms: './node_modules/ms/index.js',
  'normalize-url': './node_modules/normalize-url/index.js',
  'parse-url': './node_modules/parse-url/dist/index.js',
  'php-escape-shell': './node_modules/php-escape-shell/php-escape-shell.js',
  plist: './node_modules/plist/index.js',
  'react-dom': 'react-dom',
  'react-dom/client': 'react-dom/client',
  'react-redux': 'react-redux',
  react: 'react',
  'react/jsx-runtime': 'react/jsx-runtime',
  'react/jsx-dev-runtime': 'react/jsx-dev-runtime',
  'redux-thunk': 'redux-thunk',
  redux: 'redux',
  reselect: './node_modules/reselect/lib/index.js',
  'seamless-immutable': './node_modules/seamless-immutable/src/seamless-immutable.js',
  stylis: './node_modules/stylis/stylis.js',
  'xterm-addon-unicode11': './node_modules/xterm-addon-unicode11/lib/xterm-addon-unicode11.js',
  args: './node_modules/args/lib/index.js',
  mousetrap: './node_modules/mousetrap/mousetrap.js',
  open: './node_modules/open/index.js',
  'xterm-addon-fit': './node_modules/xterm-addon-fit/lib/xterm-addon-fit.js',
  'xterm-addon-image': './node_modules/xterm-addon-image/lib/xterm-addon-image.js',
  'xterm-addon-search': './node_modules/xterm-addon-search/lib/xterm-addon-search.js',
  'xterm-addon-web-links': './node_modules/xterm-addon-web-links/lib/xterm-addon-web-links.js',
  'xterm-addon-webgl': './node_modules/xterm-addon-webgl/lib/xterm-addon-webgl.js',
  'xterm-addon-canvas': './node_modules/xterm-addon-canvas/lib/xterm-addon-canvas.js',
  xterm: './node_modules/xterm/lib/xterm.js',
  electron: 'electron',
  '@electron/remote': '@electron/remote'
} as const;

export type RendererExternalModule = keyof typeof rendererExternalRequireMap;

// `.js.map` requests are sidecar source maps we do not ship at runtime, and
// `spawn-sync` is blocked in the renderer by the IPC child-process shim.
export const ignoredImportPatterns = [/.*\.js\.map$/i, /^spawn-sync$/i] as const;
