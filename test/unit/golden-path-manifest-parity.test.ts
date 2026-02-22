/** @file Guards against drift between app and shared golden-path manifest definitions. */
import {expect, test} from 'bun:test';

import * as appRuntimeGoldenPath from '../../app/runtime/golden-path-demo';
import * as sharedRuntimeGoldenPath from '../../shared/src/runtime/golden-path-demo';

test('app and shared golden-path runtime exports remain equivalent', () => {
  expect(appRuntimeGoldenPath.GOLDEN_PATH_PLUGIN_ID).toBe(sharedRuntimeGoldenPath.GOLDEN_PATH_PLUGIN_ID);
  expect(appRuntimeGoldenPath.GOLDEN_PATH_COMMAND_ID).toBe(sharedRuntimeGoldenPath.GOLDEN_PATH_COMMAND_ID);
  expect(appRuntimeGoldenPath.GOLDEN_PATH_KEYBINDING).toBe(sharedRuntimeGoldenPath.GOLDEN_PATH_KEYBINDING);

  expect(appRuntimeGoldenPath.goldenPathSettingsDefaults).toEqual(sharedRuntimeGoldenPath.goldenPathSettingsDefaults);
  expect(appRuntimeGoldenPath.goldenPathSettingsSchema).toEqual(sharedRuntimeGoldenPath.goldenPathSettingsSchema);
  expect(appRuntimeGoldenPath.goldenPathCommandDefinition).toEqual(sharedRuntimeGoldenPath.goldenPathCommandDefinition);

  expect(appRuntimeGoldenPath.goldenPathPluginManifest.id).toBe(sharedRuntimeGoldenPath.goldenPathPluginManifest.id);
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.version).toBe(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.version
  );
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.displayName).toBe(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.displayName
  );
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.description).toBe(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.description
  );
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.settingsSchema).toEqual(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.settingsSchema
  );
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.settingsDefaults).toEqual(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.settingsDefaults
  );
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.commands).toEqual(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.commands
  );
  expect(appRuntimeGoldenPath.goldenPathPluginManifest.keybindings).toEqual(
    sharedRuntimeGoldenPath.goldenPathPluginManifest.keybindings
  );

  const appProviders = appRuntimeGoldenPath.goldenPathPluginManifest.tabDecorationProviders;
  const sharedProviders = sharedRuntimeGoldenPath.goldenPathPluginManifest.tabDecorationProviders;
  const context = {
    tabId: 'tab-1',
    tabIndex: 0,
    active: true,
    hasActivity: true,
    title: 'Shell'
  };
  const settings = {
    ...sharedRuntimeGoldenPath.goldenPathSettingsDefaults
  };

  expect(appProviders.length).toBe(sharedProviders.length);
  appProviders.forEach((appProvider, index) => {
    const sharedProvider = sharedProviders[index];
    expect(appProvider.id).toBe(sharedProvider.id);
    expect(appProvider.priority).toBe(sharedProvider.priority);
    expect(appProvider.provideDecoration(context, settings)).toEqual(
      sharedProvider.provideDecoration(context, settings)
    );
  });
});
