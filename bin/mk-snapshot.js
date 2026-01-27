const childProcess = require('node:child_process');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const electronLink = require('electron-link');
const {mkdirp} = require('fs-extra');
const {normaliseArch} = require('./shared/arch');

const excludedModules = {};

const crossArchDirs = ['clang_x86_v8_arm', 'clang_x64_v8_arm64', 'win_clang_x64'];

async function main() {
  const baseDirPath = path.resolve(__dirname, '..');

  console.log('Creating a linked script..');
  const result = await electronLink({
    baseDirPath: baseDirPath,
    mainPath: `${__dirname}/snapshot-libs.js`,
    cachePath: `${baseDirPath}/cache`,
    // eslint-disable-next-line no-prototype-builtins
    shouldExcludeModule: (modulePath) => Object.hasOwn(excludedModules, modulePath)
  });

  const snapshotScriptPath = `${baseDirPath}/cache/snapshot-libs.js`;
  fs.writeFileSync(snapshotScriptPath, result.snapshotScript);

  // Verify if we will be able to use this in `mksnapshot`
  vm.runInNewContext(result.snapshotScript, undefined, {filename: snapshotScriptPath, displayErrors: true});

  const targetArch = normaliseArch(process.env.npm_config_arch || process.arch);
  const outputBlobPath = `${baseDirPath}/cache/${targetArch}`;
  await mkdirp(outputBlobPath);

  if (process.platform !== 'darwin') {
    const mksnapshotBinPath = `${baseDirPath}/node_modules/electron-mksnapshot/bin`;
    const matchingDirs = crossArchDirs.map((dir) => `${mksnapshotBinPath}/${dir}`).filter((dir) => fs.existsSync(dir));
    for (const dir of matchingDirs) {
      if (fs.existsSync(`${mksnapshotBinPath}/gen/v8/embedded.S`)) {
        await mkdirp(`${dir}/gen/v8`);
        fs.copyFileSync(`${mksnapshotBinPath}/gen/v8/embedded.S`, `${dir}/gen/v8/embedded.S`);
      }
    }
  }

  console.log(`Generating startup blob in "${outputBlobPath}"`);
  childProcess.execFileSync(
    process.execPath,
    [path.resolve(__dirname, 'mksnapshot-wrapper.js'), snapshotScriptPath, '--output_dir', outputBlobPath],
    {stdio: 'inherit'}
  );
}

main().catch((err) => console.error(err));
