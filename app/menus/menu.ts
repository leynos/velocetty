// Packages
import {app, dialog, Menu} from 'electron';

// Utilities
import {execCommand} from '../commands';
import {getConfig} from '../config';
import {icon} from '../config/paths';
import {getDecoratedKeymaps} from '../plugins';
import {
  getAggregatedInputSendToWriteLatencyMetrics,
  getAggregatedRendererRuntimeMetrics,
  getPtyBatchingThresholdMetrics,
  getRendererTypes,
  getRendererFallbackReasonCounts,
  getRendererWebGLContextCounts
} from '../utils/renderer-utils';
import type {RuntimeLatencyMetrics} from '@shared/types/common';

import darwinMenu from './menus/darwin';
import editMenu from './menus/edit';
import helpMenu from './menus/help';
import shellMenu from './menus/shell';
import toolsMenu from './menus/tools';
import viewMenu from './menus/view';
import windowMenu from './menus/window';

const appName = app.name;
const appVersion = app.getVersion();

let menu_: Menu;
const formatAverageMs = (totalMs: number, sampleCount: number) =>
  sampleCount > 0 ? (totalMs / sampleCount).toFixed(2) : 'n/a';
const formatLatencySummary = (metrics: RuntimeLatencyMetrics) => {
  if (metrics.sampleCount === 0) {
    return 'no samples';
  }

  return `avg ${formatAverageMs(metrics.totalMs, metrics.sampleCount)}ms, max ${metrics.maxMs.toFixed(
    2
  )}ms, last ${metrics.lastMs.toFixed(2)}ms (n=${metrics.sampleCount})`;
};

export const createMenu = (getLoadedPluginVersions: () => {name: string; version: string}[]) => {
  const config = getConfig();
  // We take only first shortcut in array for each command
  const allCommandKeys = getDecoratedKeymaps();
  const commandKeys = Object.keys(allCommandKeys).reduce((result: Record<string, string>, command) => {
    result[command] = allCommandKeys[command][0];
    return result;
  }, {});

  let updateChannel = 'stable';

  if (config?.updateChannel && config.updateChannel === 'canary') {
    updateChannel = 'canary';
  }

  const showAbout = () => {
    const loadedPlugins = getLoadedPluginVersions();
    const pluginList =
      loadedPlugins.length === 0 ? 'none' : loadedPlugins.map((plugin) => `\n  ${plugin.name} (${plugin.version})`);

    const rendererCounts = Object.values(getRendererTypes()).reduce((acc: Record<string, number>, type) => {
      acc[type] = acc[type] ? acc[type] + 1 : 1;
      return acc;
    }, {});
    const renderers = Object.entries(rendererCounts)
      .map(([type, count]) => type + (count > 1 ? ` (${count})` : ''))
      .join(', ');
    const fallbackReasonCounts = getRendererFallbackReasonCounts();
    const fallbackTotal = Object.values(fallbackReasonCounts).reduce((total, count) => total + count, 0);
    const fallbackReasons = Object.entries(fallbackReasonCounts)
      .map(([reason, count]) => reason + (count > 1 ? ` (${count})` : ''))
      .join(', ');
    const webGLContextCounts = getRendererWebGLContextCounts();
    const rendererRuntimeMetrics = getAggregatedRendererRuntimeMetrics();
    const inputSendToWriteLatency = getAggregatedInputSendToWriteLatencyMetrics();
    const batchingThresholdMetrics = getPtyBatchingThresholdMetrics();

    void dialog.showMessageBox({
      title: `About ${appName}`,
      message: `${appName} ${appVersion} (${updateChannel})`,
      detail:
        `Renderers: ${renderers}\n` +
        `WebGL contexts: current ${webGLContextCounts.current}, peak ${webGLContextCounts.peak}\n` +
        `Renderer fallbacks: total ${fallbackTotal}; reasons: ${fallbackReasons || 'none'}\n` +
        `Input latency: keydown->send ${formatLatencySummary(
          rendererRuntimeMetrics.inputKeydownToSend
        )}; send->write ${formatLatencySummary(inputSendToWriteLatency)}\n` +
        `Frame timing: avg ${formatAverageMs(
          rendererRuntimeMetrics.frameTiming.totalMs,
          rendererRuntimeMetrics.frameTiming.sampleCount
        )}ms, max ${rendererRuntimeMetrics.frameTiming.maxMs.toFixed(2)}ms, long frames ${
          rendererRuntimeMetrics.frameTiming.longFrameCount
        } (> ${rendererRuntimeMetrics.frameTiming.longFrameThresholdMs}ms, n=${
          rendererRuntimeMetrics.frameTiming.sampleCount
        })\n` +
        `PTY batching thresholds: ${batchingThresholdMetrics.durationMs}ms / ${
          batchingThresholdMetrics.maxKilobytes
        }KB (${batchingThresholdMetrics.maxBytes} bytes); parity ${
          batchingThresholdMetrics.parity ? 'ok' : 'mismatch'
        }\n` +
        `Plugins: ${pluginList}\n\n` +
        'Created by Guillermo Rauch\nCopyright © 2022 Vercel, Inc.',
      buttons: [],
      icon: icon as any
    });
  };
  const menu = [
    ...(process.platform === 'darwin' ? [darwinMenu(commandKeys, execCommand, showAbout)] : []),
    shellMenu(
      commandKeys,
      execCommand,
      getConfig().profiles.map((p) => p.name)
    ),
    editMenu(commandKeys, execCommand),
    viewMenu(commandKeys, execCommand),
    toolsMenu(commandKeys, execCommand),
    windowMenu(commandKeys, execCommand),
    helpMenu(commandKeys, showAbout)
  ];

  return menu;
};

export const buildMenu = (template: Electron.MenuItemConstructorOptions[]): Electron.Menu => {
  menu_ = Menu.buildFromTemplate(template);
  return menu_;
};
