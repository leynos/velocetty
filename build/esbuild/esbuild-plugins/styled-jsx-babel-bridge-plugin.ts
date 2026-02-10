/** @file Applies `styled-jsx` Babel transform only where required. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {transformAsync} from '@babel/core';
import type {Plugin} from 'esbuild';
import styledJsxBabelPlugin from 'styled-jsx/babel';

import {styledJsxBabelPluginOptions} from '../constants';

const TSX_FILTER = /\.[jt]sx$/;
const STYLE_JSX_USAGE_PATTERN = /<style\b[^>]*\bjsx(?:\s*=|\s|>)/;

/** Returns true when source contains `styled-jsx` style tags. */
export const usesStyledJsx = (source: string): boolean => {
  return STYLE_JSX_USAGE_PATTERN.test(source);
};

/**
 * Runs a narrowly-scoped Babel transform for files that use `styled-jsx`.
 * esbuild still handles bundling and non-styled-jsx transforms.
 */
export const transformStyledJsxSource = async (source: string, filePath: string) => {
  const transformed = await transformAsync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    sourceMaps: false,
    presets: [
      [
        '@babel/preset-typescript',
        {
          isTSX: true,
          allExtensions: true
        }
      ],
      [
        '@babel/preset-react',
        {
          runtime: 'automatic'
        }
      ]
    ],
    plugins: [[styledJsxBabelPlugin, styledJsxBabelPluginOptions]]
  });

  if (!transformed?.code) {
    throw new Error(`styled-jsx transform returned no code for ${filePath}`);
  }

  return {
    code: transformed.code
  };
};

/** Esbuild plugin that bridges styled-jsx through Babel only for matching files. */
export const createStyledJsxBabelBridgePlugin = (): Plugin => {
  return {
    name: 'styled-jsx-babel-bridge',
    setup(build) {
      build.onLoad({filter: TSX_FILTER}, async ({path: filePath}) => {
        const source = await readFile(filePath, 'utf8');
        if (!usesStyledJsx(source)) {
          return null;
        }

        const transformed = await transformStyledJsxSource(source, filePath);
        return {
          loader: 'js',
          resolveDir: path.dirname(filePath),
          contents: transformed.code
        };
      });
    }
  };
};
