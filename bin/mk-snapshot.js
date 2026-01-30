import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

import electronLink from 'electron-link';

import {normaliseArch} from './shared/arch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep as a placeholder for future module exclusion configuration.
const excludedModules = {};

const crossArchDirs = ['clang_x86_v8_arm', 'clang_x64_v8_arm64', 'win_clang_x64'];

async function main() {
  const baseDirPath = path.resolve(__dirname, '..');

  console.log('Creating a linked script..');
  const result = await electronLink({
    baseDirPath: baseDirPath,
    mainPath: `${__dirname}/snapshot-libs.js`,
    cachePath: `${baseDirPath}/cache`,
    shouldExcludeModule: (modulePath) => Object.hasOwn(excludedModules, modulePath)
  });

  const snapshotScriptPath = `${baseDirPath}/cache/snapshot-libs.js`;
  fs.writeFileSync(snapshotScriptPath, result.snapshotScript);

  // Verify if we will be able to use this in `mksnapshot`
  vm.runInNewContext(result.snapshotScript, undefined, {filename: snapshotScriptPath, displayErrors: true});

  const targetArch = normaliseArch(process.env.npm_config_arch || process.arch);
  const outputBlobPath = `${baseDirPath}/cache/${targetArch}`;
  await fs.promises.mkdir(outputBlobPath, {recursive: true});

  if (process.platform !== 'darwin') {
    const mksnapshotBinPath = `${baseDirPath}/node_modules/electron-mksnapshot/bin`;
    const embeddedSPath = `${mksnapshotBinPath}/gen/v8/embedded.S`;
    const matchingDirs = crossArchDirs.map((dir) => `${mksnapshotBinPath}/${dir}`).filter((dir) => fs.existsSync(dir));
    if (fs.existsSync(embeddedSPath)) {
      await Promise.all(
        matchingDirs.map(async (dir) => {
          await fs.promises.mkdir(`${dir}/gen/v8`, {recursive: true});
          await fs.promises.copyFile(embeddedSPath, `${dir}/gen/v8/embedded.S`);
        })
      );
    }
  }

  console.log(`Generating startup blob in "${outputBlobPath}"`);
  childProcess.execFileSync(
    process.execPath,
    [path.resolve(__dirname, 'mksnapshot-wrapper.js'), snapshotScriptPath, '--output_dir', outputBlobPath],
    {stdio: 'inherit'}
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
