/** @file Contract tests for esbuild migration translation, packaging, and plugins. */
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {build as runEsbuildBuild, type BuildOptions} from 'esbuild';
import {expect, test} from 'bun:test';

import {copyHyperAppArtifacts, copyRendererArtifacts} from '../../build/esbuild/copy-artifacts';
import {createCliBuildOptions, createRendererBuildOptions} from '../../build/esbuild/run-esbuild';
import {
  shouldIgnoreImportPath,
  createIgnoreImportsPlugin
} from '../../build/esbuild/esbuild-plugins/ignore-imports-plugin';
import {createNodeBuiltinsPlugin, isNodeBuiltinImport} from '../../build/esbuild/esbuild-plugins/node-builtins-plugin';
import {
  createRendererExternalsPlugin,
  resolveRendererExternalPath
} from '../../build/esbuild/esbuild-plugins/renderer-externals-plugin';
import {
  createStyledJsxBabelBridgePlugin,
  usesStyledJsx
} from '../../build/esbuild/esbuild-plugins/styled-jsx-babel-bridge-plugin';

const createTempDir = () => mkdtemp(path.join(tmpdir(), 'velocetty-esbuild-'));

const writeFixtureFile = async (filePath: string, content: string) => {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
};

type PluginFixtureBuildOptions = Pick<BuildOptions, 'platform' | 'format' | 'plugins'>;

const testPluginWithFixture = async (fixtureCode: string, buildOptions: PluginFixtureBuildOptions) => {
  const rootDir = await createTempDir();
  try {
    const entryPoint = path.join(rootDir, 'entry.ts');
    await writeFixtureFile(entryPoint, fixtureCode);

    const buildResult = await runEsbuildBuild({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      outfile: path.join(rootDir, 'bundle.js'),
      ...buildOptions
    });

    return buildResult.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
};

test('translation: styled-jsx bridge transforms JSX style blocks', async () => {
  const rootDir = await createTempDir();
  try {
    const entryPoint = path.join(rootDir, 'fixture.tsx');
    await writeFixtureFile(
      entryPoint,
      [
        "import React from 'react';",
        'export const Fixture = () => (',
        '  <div>',
        '    <span className="x">ok</span>',
        '    <style jsx={true}>{`.x { color: red; }`}</style>',
        '    <style jsx={true} global={true}>{`body { margin: 0; }`}</style>',
        '  </div>',
        ');'
      ].join('\n')
    );

    const buildResult = await runEsbuildBuild({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      outfile: path.join(rootDir, 'bundle.js'),
      platform: 'browser',
      format: 'iife',
      external: ['react', 'react/jsx-runtime', 'styled-jsx/style'],
      plugins: [createStyledJsxBabelBridgePlugin()]
    });

    const bundleOutput = buildResult.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
    expect(bundleOutput.includes('styled-jsx/style')).toBe(true);
    expect(bundleOutput.includes('<style jsx')).toBe(false);
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});

test('packaging: hyper-app and renderer copy flows preserve required files', async () => {
  const rootDir = await createTempDir();
  try {
    await writeFixtureFile(path.join(rootDir, 'app', 'index.html'), '<html></html>');
    await writeFixtureFile(path.join(rootDir, 'app', 'package.json'), '{"name":"fixture"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'tsconfig.json'), '{"extends":"../tsconfig.base.json"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'config', 'schema.json'), '{"type":"object"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'keymaps', 'linux.json'), '{"key":"value"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'static', 'icon.png'), 'png-data');
    await writeFixtureFile(path.join(rootDir, 'assets', 'icons.svg'), '<svg></svg>');

    await copyHyperAppArtifacts({
      rootDir,
      targetDir: path.join(rootDir, 'target')
    });
    await copyRendererArtifacts({
      rootDir,
      targetDir: path.join(rootDir, 'target', 'renderer')
    });

    const copiedHtml = await readFile(path.join(rootDir, 'target', 'index.html'), 'utf8');
    const copiedConfig = await readFile(path.join(rootDir, 'target', 'config', 'schema.json'), 'utf8');
    const copiedKeymap = await readFile(path.join(rootDir, 'target', 'keymaps', 'linux.json'), 'utf8');
    const copiedAsset = await readFile(path.join(rootDir, 'target', 'renderer', 'assets', 'icons.svg'), 'utf8');

    expect(copiedHtml).toBe('<html></html>');
    expect(copiedConfig).toBe('{"type":"object"}');
    expect(copiedKeymap).toBe('{"key":"value"}');
    expect(copiedAsset).toBe('<svg></svg>');
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});

test('plugin validation: renderer externals map to legacy runtime require paths', async () => {
  const resolved = resolveRendererExternalPath('lodash');
  expect(resolved).toBe('./node_modules/lodash/lodash.js');

  const bundleOutput = await testPluginWithFixture("import lodash from 'lodash'; console.log(lodash);", {
    platform: 'browser',
    format: 'iife',
    plugins: [createRendererExternalsPlugin()]
  });
  expect(bundleOutput.includes('require("./node_modules/lodash/lodash.js")')).toBe(true);
});

test('plugin validation: ignored imports remain unresolved externals', async () => {
  expect(shouldIgnoreImportPath('spawn-sync')).toBe(true);
  expect(shouldIgnoreImportPath('something.js.map')).toBe(true);
  expect(shouldIgnoreImportPath('react')).toBe(false);

  const bundleOutput = await testPluginWithFixture("import spawnSync from 'spawn-sync'; console.log(spawnSync);", {
    platform: 'node',
    format: 'cjs',
    plugins: [createIgnoreImportsPlugin()]
  });
  expect(bundleOutput.includes('require("spawn-sync")')).toBe(true);
});

test('plugin validation: node built-ins are externalized for runtime resolution', async () => {
  expect(isNodeBuiltinImport('node:fs')).toBe(true);
  expect(isNodeBuiltinImport('fs')).toBe(true);
  expect(isNodeBuiltinImport('lodash')).toBe(false);

  const bundleOutput = await testPluginWithFixture("import fs from 'node:fs'; console.log(Boolean(fs));", {
    platform: 'browser',
    format: 'iife',
    plugins: [createNodeBuiltinsPlugin()]
  });
  expect(bundleOutput.includes('require("node:fs")')).toBe(true);
});

test('translation: build options keep source maps in development and minify in production', () => {
  const rootDir = '/tmp/velocetty-esbuild-options';
  const developmentRenderer = createRendererBuildOptions('development', rootDir);
  const productionRenderer = createRendererBuildOptions('production', rootDir);
  const developmentCli = createCliBuildOptions('development', rootDir);
  const productionCli = createCliBuildOptions('production', rootDir);

  expect(developmentRenderer.sourcemap).toBe('linked');
  expect(productionRenderer.sourcemap).toBe('external');
  expect(productionRenderer.minify).toBe(true);
  expect(developmentCli.sourcemap).toBe('linked');
  expect(productionCli.sourcemap).toBe(false);
  expect(productionCli.minify).toBe(true);
});

test('translation: styled-jsx usage detection only flags matching files', () => {
  expect(usesStyledJsx('<style jsx={true}>{``}</style>')).toBe(true);
  expect(usesStyledJsx('<style>{``}</style>')).toBe(false);
});

test('translation: esbuild handles shebang-bearing dependencies without shebang-loader', async () => {
  const rootDir = await createTempDir();
  try {
    await writeFixtureFile(
      path.join(rootDir, 'node_modules', 'rc', 'index.js'),
      ['#!/usr/bin/env node', 'module.exports = {name: "rc"};'].join('\n')
    );
    const entryPoint = path.join(rootDir, 'entry.ts');
    await writeFixtureFile(entryPoint, "import rc from 'rc'; console.log(rc.name);");

    const buildResult = await runEsbuildBuild({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      outfile: path.join(rootDir, 'bundle.js'),
      platform: 'node',
      format: 'cjs'
    });

    const bundleOutput = buildResult.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
    expect(bundleOutput.includes('rc')).toBe(true);
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});
