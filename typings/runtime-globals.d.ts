/** @file Shared runtime global typings used across app and renderer modules. */

import type {SnapshotRuntimeResult} from '../lib/v8-snapshot-util';

export type VelocettyRuntimeGlobals = {
  __velocettyAppRoot?: string;
};

declare global {
  var snapshotResult: SnapshotRuntimeResult | undefined;
}
