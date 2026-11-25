/** @file Composition checks for the defaults the `app/config.ts` root wires in. */
/*
 * The pure colour helpers are covered by `colours.test.ts`. What only the
 * composition root can get wrong is the wiring: which imported palette it
 * copies before decoration, and what decoration falls back to when a plugin
 * removes a colour or a later bundled-file read fails. Every case therefore
 * runs the production `decorateProfileConfig` entry point over the
 * composition root's own adapters.
 */
import {expect, mock, test} from 'bun:test';

import {readFile} from 'node:fs/promises';

import type {ColorMap, configOptions, parsedConfig} from '@shared/types/config';

import {fallbackColors} from '../../app/utils/colours';
import {createWatchHarness, makeParsedConfig} from '../testUtils/config-watch-harness';

/**
 * A parsed configuration whose imported palette is `colors`.
 *
 * The palette is partial because that is what a user config supplies; the
 * composition root is what fills the remaining slots.
 */
const configWithPalette = (colors: Partial<ColorMap>): parsedConfig => {
  const parsed = makeParsedConfig({});
  // SAFETY: the importer stores the user's partial map as-is; only decoration
  // completes it, which is the behaviour under test.
  return {...parsed, config: {...parsed.config, colors: colors as ColorMap}};
};

/** Returns a decorator that removes one colour from a copy of the config. */
const removingColour =
  (colour: keyof ColorMap) =>
  (baseConfig: configOptions): configOptions => {
    const decorated = {...baseConfig, colors: {...baseConfig.colors}};
    // `ColorMap` types every slot as present; a plugin's runtime result may
    // omit one, which is exactly the case decoration has to repair.
    Reflect.deleteProperty(decorated.colors, colour);
    return decorated;
  };

/** Identity decoration, for cases about the palette layering alone. */
const keepingConfig = (baseConfig: configOptions): configOptions => baseConfig;

/**
 * Reads the plugin integration that calls the composition root.
 *
 * `app/plugins.ts` cannot be imported here: loading it patches `Module._load`
 * for the whole test process and constructs the plugin store. Its call site is
 * still the part that can silently bypass the palette copy, so the contract is
 * pinned against the source instead.
 */
const readPluginsSource = () => readFile(new URL('../../app/plugins.ts', import.meta.url), 'utf8');

test.serial('decoration completes the imported palette from the last-resort colours', async () => {
  const harness = await createWatchHarness();
  try {
    harness.setConfig(configWithPalette({black: '#123456'}));
    harness.configModule.setup();

    const decorated = harness.configModule.decorateProfileConfig('default', (baseConfig) => ({
      ...baseConfig,
      colors: {...baseConfig.colors, red: '#654321'}
    }));

    // The imported black and the decorator's red survive, and every slot
    // neither names comes from the last-resort palette, so the map is total
    // for xterm. Whole-map equality states the last layer once for every slot.
    expect(decorated.colors).toEqual({...fallbackColors(), black: '#123456', red: '#654321'});
  } finally {
    mock.restore();
  }
});

test.serial('a plugin that removes a colour cannot remove the imported default', async () => {
  const harness = await createWatchHarness();
  try {
    // Deliberately unlike the fallback black, so equality with the fallback
    // cannot make a discarded imported colour look preserved.
    harness.setConfig(configWithPalette({black: '#123456', red: '#654321'}));
    harness.configModule.setup();

    const decorated = harness.configModule.decorateProfileConfig('default', removingColour('black'));

    expect(decorated.colors.black).toBe('#123456');
    expect(decorated.colors.red).toBe('#654321');
  } finally {
    mock.restore();
  }
});

test.serial('a later bundled-file read fault cannot change the decorated colours', async () => {
  const harness = await createWatchHarness();
  try {
    harness.setConfig(configWithPalette({black: '#123456'}));
    harness.configModule.setup();
    const first = harness.configModule.decorateProfileConfig('default', keepingConfig);
    expect(first.colors.black).toBe('#123456');

    // Decoration happens whenever a window or the preferences editor opens.
    // The palette was copied during import, so a read fault after that point
    // must not alter, or abort, a later decoration.
    harness.importMock.mockImplementation(() => {
      throw new Error('the bundled default file could not be read');
    });
    const second = harness.configModule.decorateProfileConfig('default', keepingConfig);

    expect(second.colors).toEqual(first.colors);
    expect(second.colors.black).toBe('#123456');
  } finally {
    mock.restore();
  }
});

test.serial('a decorator that edits a nested setting in place cannot change the applied configuration', async () => {
  const harness = await createWatchHarness();
  try {
    harness.setConfig(configWithPalette({black: '#123456'}));
    harness.configModule.setup();

    const decorated = harness.configModule.decorateProfileConfig('default', (baseConfig) => {
      // A decorator is plugin code. Editing the map it is handed, rather than
      // returning a new one, is exactly what must not reach applied state.
      baseConfig.colors.red = '#654321';
      return baseConfig;
    });

    // The decorator's own edit still takes effect on the configuration it
    // hands back; only the process-wide applied copy is protected.
    expect(decorated.colors.red).toBe('#654321');
    expect(harness.configModule.getProfileConfig('default').colors.red).toBeUndefined();
  } finally {
    mock.restore();
  }
});

test('the plugin integration takes its palette from the composition root', async () => {
  const pluginsSource = await readPluginsSource();

  // `getDecoratedConfig` is the caller that supplies the plugin decorator. If
  // it read the profile and decorated that directly, the copied palette would
  // be bypassed and the tests above would still pass.
  expect(pluginsSource).toContain('config.decorateProfileConfig(profile,');
  expect(pluginsSource).toContain("decorateObject(baseConfig, 'decorateConfig')");
  expect(pluginsSource).not.toContain('config.fixConfigDefaults');
  expect(pluginsSource).not.toContain('config.getProfileConfig');
});
