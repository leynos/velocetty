/**
 * @file E2E-KB-0 to E2E-KB-4: keybindings storage, migration, and reload.
 * Usage: set RUN_E2E=1 after `bun run test:e2e:prepare` has built `dist/app`.
 */
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {expect} from 'bun:test';

import {E2E_PROBE_SHORTCUT} from '../../app/config/e2e-keymap-probe';
import {createIsolatedE2EEnvironment} from './electron-e2e-helpers';
import {
  configFilesIn,
  e2eTest,
  launchApp,
  legacyHyperConfig,
  noRecreationWaitMs,
  platformDefaultShortcut,
  probeMarker,
  replaceFileAtomically,
  scenarioTimeoutMs,
  sleep
} from './keybindings-e2e-harness';

e2eTest(
  'E2E-KB-0 a fresh install creates both files in the Velocetty tree only',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    try {
      const app = await launchApp(environment);
      try {
        await app.waitFor({description: 'the config watcher', matcher: /\[e2e\] config-watcher-ready/});
        expect(existsSync(path.join(environment.velocettyConfigDir, 'config.json5'))).toBe(true);
        expect(existsSync(path.join(environment.velocettyConfigDir, 'keybindings.json5'))).toBe(true);
        expect(await configFilesIn({directory: environment.hyperConfigDir})).toEqual([]);
      } finally {
        await app.stop();
      }
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);

e2eTest(
  'E2E-KB-1 migrates legacy Hyper keymaps without touching the Hyper tree',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    try {
      const hyperConfigPath = await environment.seedFile({
        configDir: environment.hyperConfigDir,
        contents: legacyHyperConfig({keymaps: `{'window:new': '${E2E_PROBE_SHORTCUT}'}`}),
        fileName: 'config.json5'
      });
      const hyperBytesBefore = await fs.readFile(hyperConfigPath);

      const app = await launchApp(environment);
      try {
        const keybindingsLine = await app.waitFor({
          description: 'the keybindings path marker',
          matcher: /\[e2e\] keybindings-path .+/
        });
        expect(keybindingsLine).toBe(
          `[e2e] keybindings-path ${path.join(environment.velocettyConfigDir, 'keybindings.json5')}`
        );
        const configPathLine = await app.waitFor({
          description: 'the config path marker',
          matcher: /\[e2e\] config-path .+/
        });
        expect(configPathLine).toBe(`[e2e] config-path ${hyperConfigPath}`);
        await app.waitFor({
          description: 'the migrated keymap',
          matcher: probeMarker({shortcut: E2E_PROBE_SHORTCUT, status: 'applied'})
        });

        const seeded = await fs.readFile(path.join(environment.velocettyConfigDir, 'keybindings.json5'), 'utf8');
        expect(seeded).toContain(E2E_PROBE_SHORTCUT);
        expect(await configFilesIn({directory: environment.hyperConfigDir})).toEqual(['config.json5']);
        const hyperBytesAfter = await fs.readFile(hyperConfigPath);
        expect(hyperBytesAfter.equals(hyperBytesBefore)).toBe(true);
      } finally {
        await app.stop();
      }
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);

e2eTest(
  'E2E-KB-2 to E2E-KB-4 hot reload, invalid files, and deletion',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    const keybindingsPath = path.join(environment.velocettyConfigDir, 'keybindings.json5');
    try {
      await environment.seedFile({
        configDir: environment.hyperConfigDir,
        contents: legacyHyperConfig({keymaps: `{'window:new': '${E2E_PROBE_SHORTCUT}'}`}),
        fileName: 'config.json5'
      });

      const app = await launchApp(environment);
      try {
        await app.waitFor({description: 'the config watcher', matcher: /\[e2e\] config-watcher-ready/});
        await app.waitFor({
          description: 'the seeded keymap',
          matcher: probeMarker({shortcut: E2E_PROBE_SHORTCUT, status: 'applied'})
        });

        await fs.writeFile(keybindingsPath, `{'window:new': 'ctrl+alt+shift+m'}`, 'utf8');
        await app.waitFor({
          description: 'the first hot reload',
          matcher: probeMarker({shortcut: 'ctrl+alt+shift+m', status: 'applied'})
        });

        await replaceFileAtomically({contents: `{'window:new': 'ctrl+alt+shift+k'}`, filePath: keybindingsPath});
        await app.waitFor({
          description: 'the atomic-replace reload',
          matcher: probeMarker({shortcut: 'ctrl+alt+shift+k', status: 'applied'})
        });

        await fs.writeFile(keybindingsPath, `{'window:new':`, 'utf8');
        await app.waitFor({
          description: 'the last-known-good reload',
          matcher: probeMarker({shortcut: 'ctrl+alt+shift+k', status: 'kept'})
        });

        await fs.rm(keybindingsPath);
        const defaultShortcut = await platformDefaultShortcut();
        await app.waitFor({
          description: 'the deletion reload',
          matcher: probeMarker({shortcut: defaultShortcut, status: 'applied'})
        });

        await sleep(noRecreationWaitMs);
        expect(existsSync(keybindingsPath)).toBe(false);
      } finally {
        await app.stop();
      }
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);

e2eTest(
  'a relaunch reads the persisted edit and rewrites nothing',
  async () => {
    // The legacy value differs from the persisted one, so a relaunch that
    // re-migrated instead of reading the file could not pass by coincidence.
    const legacyShortcut = 'ctrl+alt+shift+j';
    const editedShortcut = 'ctrl+alt+shift+q';
    const environment = await createIsolatedE2EEnvironment();
    try {
      const hyperConfigPath = await environment.seedFile({
        configDir: environment.hyperConfigDir,
        contents: legacyHyperConfig({keymaps: `{'window:new': '${legacyShortcut}'}`}),
        fileName: 'config.json5'
      });
      const keybindingsPath = await environment.seedFile({
        configDir: environment.velocettyConfigDir,
        contents: `{'window:new': '${E2E_PROBE_SHORTCUT}'}`,
        fileName: 'keybindings.json5'
      });
      const configBefore = await fs.readFile(hyperConfigPath);

      const firstLaunch = await launchApp(environment);
      try {
        await firstLaunch.waitFor({
          description: 'the restored keymap',
          matcher: probeMarker({shortcut: E2E_PROBE_SHORTCUT, status: 'applied'})
        });
      } finally {
        await firstLaunch.stop();
      }

      await replaceFileAtomically({contents: `{'window:new': '${editedShortcut}'}`, filePath: keybindingsPath});
      const keybindingsAfterEdit = await fs.readFile(keybindingsPath);

      const secondLaunch = await launchApp(environment);
      try {
        await secondLaunch.waitFor({
          description: 'the persisted edit',
          matcher: probeMarker({shortcut: editedShortcut, status: 'applied'})
        });
      } finally {
        await secondLaunch.stop();
      }

      const keybindingsStatBeforeThirdLaunch = await fs.stat(keybindingsPath);
      const thirdLaunch = await launchApp(environment);
      try {
        await thirdLaunch.waitFor({
          description: 'the persisted edit after a relaunch',
          matcher: probeMarker({shortcut: editedShortcut, status: 'applied'})
        });
      } finally {
        await thirdLaunch.stop();
      }

      const keybindingsAfterThirdLaunch = await fs.readFile(keybindingsPath);
      const keybindingsStatAfter = await fs.stat(keybindingsPath);
      const configAfter = await fs.readFile(hyperConfigPath);
      expect(keybindingsAfterThirdLaunch.equals(keybindingsAfterEdit)).toBe(true);
      expect(keybindingsStatAfter.mtimeMs).toBe(keybindingsStatBeforeThirdLaunch.mtimeMs);
      expect(configAfter.equals(configBefore)).toBe(true);
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs * 2
);
