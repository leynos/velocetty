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

/** Creates an isolated temporary directory for build fixture tests. */
const createTempDir = () => mkdtemp(path.join(tmpdir(), 'velocetty-esbuild-'));

/** Writes fixture source content, creating parent directories as needed. */
const writeFixtureFile = async (filePath: string, content: string) => {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
};

/** Minimal esbuild options used by plugin fixture tests. */
type PluginFixtureBuildOptions = Pick<BuildOptions, 'platform' | 'format' | 'plugins'>;

/** Builds an inline fixture and returns the emitted JavaScript output text. */
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

test('translation: CSS Modules are bundled with scoped class names in renderer build', async () => {
  const rootDir = await createTempDir();
  try {
    // Verify the renderer build options include CSS Module loader configuration
    const rendererOptions = createRendererBuildOptions('development', rootDir);
    expect(rendererOptions.loader?.['.module.css']).toBe('local-css');

    const cssPath = path.join(rootDir, 'fixture.module.css');
    const entryPoint = path.join(rootDir, 'fixture.tsx');
    await writeFixtureFile(cssPath, '.searchBox { color: red; }');
    await writeFixtureFile(
      entryPoint,
      [
        "import React from 'react';",
        "import styles from './fixture.module.css';",
        'export const Fixture = () => (',
        '  <div className={styles.searchBox}>ok</div>',
        ');'
      ].join('\n')
    );

    // Build using the renderer options to ensure real configuration is tested
    const buildResult = await runEsbuildBuild({
      ...rendererOptions,
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      outfile: path.join(rootDir, 'bundle.js')
    });

    const bundleOutput = buildResult.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
    // CSS Module class map contains the searchBox key with a non-empty scoped value
    const classMapMatch = bundleOutput.match(/searchBox:\s*"([^"]+)"/);
    expect(classMapMatch).toBeTruthy();
    // The scoped class name follows the expected pattern (module prefix + underscore + class name)
    expect(classMapMatch?.[1]).toMatch(/^fixture_searchBox$/);
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});

test('packaging: hyper-app and renderer copy flows preserve required files', async () => {
  const rootDir = await createTempDir();
  try {
    await writeFixtureFile(path.join(rootDir, 'app', 'index.html'), '<html></html>');
    await writeFixtureFile(path.join(rootDir, 'app', 'ignore.tmp'), 'ignore-me');
    await writeFixtureFile(path.join(rootDir, 'app', 'package.json'), '{"name":"fixture"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'tsconfig.json'), '{"extends":"../tsconfig.base.json"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'config', 'schema.json'), '{"type":"object"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'keymaps', 'linux.json'), '{"key":"value"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'static', 'icon.png'), 'png-data');
    await writeFixtureFile(path.join(rootDir, 'app', 'static', 'logo.svg'), '<svg>app</svg>');
    await writeFixtureFile(path.join(rootDir, 'app', 'static', 'ignore.bak'), 'skip-me');
    await writeFixtureFile(path.join(rootDir, 'assets', 'icons.svg'), '<svg></svg>');
    await writeFixtureFile(path.join(rootDir, 'assets', 'preview.png'), 'preview-png');
    await writeFixtureFile(path.join(rootDir, 'assets', 'ignore.tmp'), 'skip-me');

    await copyHyperAppArtifacts({
      rootDir,
      targetDir: path.join(rootDir, 'dist', 'app'),
      allowMissingPatches: true
    });
    await copyRendererArtifacts({
      rootDir,
      targetDir: path.join(rootDir, 'dist', 'app', 'renderer'),
      allowMissingAssets: false
    });

    const copiedHtml = await readFile(path.join(rootDir, 'dist', 'app', 'index.html'), 'utf8');
    const copiedPackageJson = await readFile(path.join(rootDir, 'dist', 'app', 'package.json'), 'utf8');
    const copiedTsconfig = await readFile(path.join(rootDir, 'dist', 'app', 'tsconfig.json'), 'utf8');
    const copiedConfig = await readFile(path.join(rootDir, 'dist', 'app', 'config', 'schema.json'), 'utf8');
    const copiedKeymap = await readFile(path.join(rootDir, 'dist', 'app', 'keymaps', 'linux.json'), 'utf8');
    const copiedStaticIcon = await readFile(path.join(rootDir, 'dist', 'app', 'static', 'icon.png'), 'utf8');
    const copiedStaticSvg = await readFile(path.join(rootDir, 'dist', 'app', 'static', 'logo.svg'), 'utf8');
    const copiedAsset = await readFile(path.join(rootDir, 'dist', 'app', 'renderer', 'assets', 'icons.svg'), 'utf8');
    const copiedAssetPng = await readFile(
      path.join(rootDir, 'dist', 'app', 'renderer', 'assets', 'preview.png'),
      'utf8'
    );

    expect(copiedHtml).toBe('<html></html>');
    expect(copiedPackageJson).toBe('{"name":"fixture"}');
    expect(copiedTsconfig).toBe('{"extends":"../tsconfig.base.json"}');
    expect(copiedConfig).toBe('{"type":"object"}');
    expect(copiedKeymap).toBe('{"key":"value"}');
    expect(copiedStaticIcon).toBe('png-data');
    expect(copiedStaticSvg).toBe('<svg>app</svg>');
    expect(copiedAsset).toBe('<svg></svg>');
    expect(copiedAssetPng).toBe('preview-png');
    await expect(readFile(path.join(rootDir, 'dist', 'app', 'ignore.tmp'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(rootDir, 'dist', 'app', 'static', 'ignore.bak'), 'utf8')).rejects.toThrow();
    await expect(
      readFile(path.join(rootDir, 'dist', 'app', 'renderer', 'assets', 'ignore.tmp'), 'utf8')
    ).rejects.toThrow();
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});

test('packaging: allowMissing options control optional copy failures', async () => {
  const rootDir = await createTempDir();
  try {
    await writeFixtureFile(path.join(rootDir, 'app', 'index.html'), '<html></html>');
    await writeFixtureFile(path.join(rootDir, 'app', 'package.json'), '{"name":"fixture"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'tsconfig.json'), '{"extends":"../tsconfig.base.json"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'config', 'schema.json'), '{"type":"object"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'keymaps', 'linux.json'), '{"key":"value"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'static', 'icon.png'), 'png-data');

    await expect(
      copyHyperAppArtifacts({
        rootDir,
        targetDir: path.join(rootDir, 'dist', 'app'),
        allowMissingPatches: true
      })
    ).resolves.toBeUndefined();
    await expect(
      copyHyperAppArtifacts({
        rootDir,
        targetDir: path.join(rootDir, 'dist', 'app'),
        allowMissingPatches: false
      })
    ).rejects.toThrow();

    await expect(
      copyRendererArtifacts({
        rootDir,
        targetDir: path.join(rootDir, 'dist', 'app', 'renderer-allow-missing'),
        allowMissingAssets: true
      })
    ).resolves.toBeUndefined();
    await expect(
      copyRendererArtifacts({
        rootDir,
        targetDir: path.join(rootDir, 'dist', 'app', 'renderer-strict'),
        allowMissingAssets: false
      })
    ).rejects.toThrow();
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});

test('packaging: app index loads renderer stylesheet output', async () => {
  const appIndexHtml = await readFile(path.join(process.cwd(), 'app', 'index.html'), 'utf8');
  expect(appIndexHtml.includes('renderer/bundle.css')).toBe(true);
});

test('packaging: hyper-app copy handles missing patches and replaces stale app-output patches', async () => {
  const rootDir = await createTempDir();
  const targetDir = path.join(rootDir, 'dist', 'app');

  try {
    await writeFixtureFile(path.join(rootDir, 'app', 'index.html'), '<html></html>');
    await writeFixtureFile(path.join(rootDir, 'app', 'package.json'), '{"name":"fixture"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'tsconfig.json'), '{"extends":"../tsconfig.base.json"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'config', 'schema.json'), '{"type":"object"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'keymaps', 'linux.json'), '{"key":"value"}');
    await writeFixtureFile(path.join(rootDir, 'app', 'static', 'icon.png'), 'png-data');
    await writeFixtureFile(path.join(targetDir, 'patches', 'stale.patch'), 'stale');

    await copyHyperAppArtifacts({rootDir, targetDir});

    await expect(readFile(path.join(targetDir, 'patches', 'stale.patch'), 'utf8')).rejects.toThrow();

    await writeFixtureFile(path.join(rootDir, 'app', 'patches', 'fresh.patch'), 'fresh');
    await copyHyperAppArtifacts({rootDir, targetDir});

    const copiedPatch = await readFile(path.join(targetDir, 'patches', 'fresh.patch'), 'utf8');
    expect(copiedPatch).toBe('fresh');
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
  expect(bundleOutput.includes('./node_modules/lodash/lodash.js')).toBe(true);
  expect(bundleOutput.includes('rendererRequire')).toBe(true);

  const reactBundleOutput = await testPluginWithFixture("import React from 'react'; console.log(Boolean(React));", {
    platform: 'browser',
    format: 'iife',
    plugins: [createRendererExternalsPlugin()]
  });
  expect(reactBundleOutput.includes('"react"') || reactBundleOutput.includes("'react'")).toBe(true);
  expect(reactBundleOutput.includes('rendererRequire')).toBe(true);
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
  const rootDir = path.join(tmpdir(), 'velocetty-esbuild-options');
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

test('translation: renderer build does not transform styled-jsx syntax', async () => {
  const rootDir = await createTempDir();
  try {
    // Create a fixture containing styled-jsx syntax that would have triggered
    // the bridge in the past. Without the bridge, esbuild passes the JSX
    // through untransformed, which would cause runtime failures since the
    // styled-jsx runtime is not available.
    const entryPoint = path.join(rootDir, 'fixture.tsx');
    await writeFixtureFile(
      entryPoint,
      [
        "import React from 'react';",
        'export const Fixture = () => (',
        '  <div>',
        '    <span className="x">ok</span>',
        '    <style jsx>{`',
        '      .x { color: red; }',
        '    `}</style>',
        '  </div>',
        ');'
      ].join('\n')
    );

    const rendererOptions = createRendererBuildOptions('development', rootDir);
    const buildResult = await runEsbuildBuild({
      ...rendererOptions,
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      outfile: path.join(rootDir, 'bundle.js')
    });

    const bundleOutput = buildResult.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';

    // Without the bridge plugin, styled-jsx blocks are passed through as raw
    // JSX elements. The output should contain the raw style tag JSX, proving
    // that esbuild does not transform styled-jsx syntax.
    // This is the expected behaviour after bridge removal - styled-jsx syntax
    // will not be scoped at runtime because the transform is no longer applied.
    expect(bundleOutput.includes('styled-jsx/style')).toBe(false);
    // Assert that the jsx attribute from the <style jsx> block is present
    // in the output (as a JSX transform property), proving the styled-jsx
    // block was passed through untransformed rather than being handled by
    // the styled-jsx babel plugin.
    expect(/jsx[:\s]/.test(bundleOutput)).toBe(true);
    // Positive assertion: verify the bundle contains the React JSX runtime
    // transformation, confirming the build succeeded and produced valid output.
    expect(bundleOutput.includes('react')).toBe(true);
    expect(bundleOutput.includes('createElement') || bundleOutput.includes('jsx')).toBe(true);
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});

test('translation: esbuild handles shebang-bearing dependencies without shebang-loader', async () => {
  const rootDir = await createTempDir();
  try {
    // This fixture intentionally uses a Node shebang to match third-party package output.
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
    expect(bundleOutput.includes('"rc"') || bundleOutput.includes("'rc'")).toBe(true);
    expect(bundleOutput.includes('name: "rc"')).toBe(true);
    expect(bundleOutput.includes('#!/usr/bin/env node')).toBe(false);
  } finally {
    await rm(rootDir, {recursive: true, force: true});
  }
});
