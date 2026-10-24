/** @file Electron-builder afterSign hook for macOS notarization. */
import {notarize} from '@electron/notarize';

export default async function notarizing(context) {
  const {electronPlatformName, appOutDir} = context;
  if (electronPlatformName !== 'darwin' || !process.env.APPLE_ID || !process.env.APPLE_PASSWORD) return;

  const appName = context.packager.appInfo.productFilename;
  return await notarize({
    appBundleId: 'co.zeit.hyper',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_PASSWORD
  });
}
