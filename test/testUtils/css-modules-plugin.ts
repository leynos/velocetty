/**
 * @file Bun plugin to handle CSS Module imports during testing.
 * Returns an identity mapping where class names map to themselves.
 */
import type {BunPlugin} from 'bun';

/**
 * Parses CSS content to extract class names.
 *
 * @param css - The CSS content to parse.
 * @returns Array of class names found in the CSS.
 */
const extractClassNames = (css: string): string[] => {
  const classNames: string[] = [];
  // Match CSS class selectors (e.g., .className, .class-name, .class_name)
  const classRegex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  for (const match of css.matchAll(classRegex)) {
    classNames.push(match[1]);
  }
  return [...new Set(classNames)]; // Remove duplicates
};

/**
 * Bun plugin for handling CSS Module imports in tests.
 *
 * @example
 * ```ts
 * import {plugin} from 'bun';
 * import cssModulesPlugin from './css-modules-plugin';
 * plugin(cssModulesPlugin);
 * ```
 */
const cssModulesPlugin: BunPlugin = {
  name: 'css-modules',
  setup(build) {
    build.onLoad({filter: /\.module\.css$/}, async (args) => {
      const css = await Bun.file(args.path).text();
      const classNames = extractClassNames(css);

      // Build an object where each class name maps to itself (identity mapping for tests)
      const classMap = Object.fromEntries(classNames.map((name) => [name, name]));

      return {
        exports: {
          default: classMap,
          ...classMap
        },
        loader: 'object'
      };
    });
  }
};

// Register the plugin with Bun
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {plugin} = require('bun');
plugin(cssModulesPlugin);

export default cssModulesPlugin;
