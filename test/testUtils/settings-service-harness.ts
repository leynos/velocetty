/**
 * @file A settings service over the in-memory config port.
 *
 * The service is observable through its port, its counters, its spans, and its
 * refusal lines, so a behavioural test can assert both what it decided and
 * what it wrote. The harness keeps those four surfaces together; suites that
 * need a file seed it through `harnessWithFile`.
 */
import {expect} from 'bun:test';
import {z} from 'zod';

import {createConfigMetrics, type ConfigCounters} from '../../app/config/config-metrics';
import {createConfigSpanRecorder} from '../../app/config/config-spans';
import type {ConfigWriterDependencies} from '../../app/config/config-file-writer';
import {createSettingsService, type SettingsService} from '../../app/settings/settings-service';
import {createMemoryConfigFileSystem} from './config-file-port';

import type {JsonObject} from '@shared/types/json';
import type {SettingTarget, SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

export const CONFIG_PATH = '/home/user/.config/Hyper/config.json5';
export const LEGACY_PATH = '/home/user/.config/Hyper/hyper.json';

/** The renderer's schema for `userValues`, which rejects non-finite numbers. */
export const USER_VALUES_SCHEMA = z.record(z.string(), z.json());

export const DEFAULTS: JsonObject = {
  fontSize: 12,
  shell: '/bin/bash',
  updateChannel: 'stable',
  colors: {black: '#000000'},
  css: ''
};

export const target = (key: SettingTarget['key']): SettingTarget => ({scope: 'core', key});

export type Harness = {
  readonly service: SettingsService;
  readonly port: ReturnType<typeof createMemoryConfigFileSystem>;
  readonly counters: () => ConfigCounters;
  readonly spans: readonly string[];
  readonly refusals: readonly string[];
};

export const createHarness = (filePath = CONFIG_PATH): Harness => {
  const port = createMemoryConfigFileSystem();
  let revision = 0;
  const metrics = createConfigMetrics();
  const spans: string[] = [];
  const refusals: string[] = [];
  const writer: ConfigWriterDependencies = {
    fileSystem: port,
    sleep: async () => {
      await Promise.resolve();
    },
    log: () => {
      // Deliberately quiet in tests.
    },
    platform: 'linux',
    processId: () => 7,
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    currentRevision: () => revision,
    recordWrittenText: () => {
      // Exercised by the writer suite.
    }
  };
  const service = createSettingsService({
    filePath,
    fileSystem: port,
    writer,
    defaults: DEFAULTS,
    getDefaultProfileName: () => 'default',
    metrics,
    log: (line) => refusals.push(line),
    spans: createConfigSpanRecorder({now: () => 0, sink: {info: (line) => spans.push(line), warn: () => {}}})
  });
  return {counters: () => metrics.snapshot(), port, refusals, service, spans};
};

export const harnessWithFile = (text: string): Harness => {
  const harness = createHarness();
  harness.port.setFile(CONFIG_PATH, text);
  return harness;
};

/** Asserts a read path wrote nothing and left the file's text alone. */
export const expectReadOnly = (harness: Harness, filePath: string, expectedText?: string): void => {
  expect(harness.port.writes).toEqual([]);
  expect(harness.port.readFile(filePath)).toBe(expectedText);
};

/** Resolves one write, requiring it to have been applied. */
export const appliedSnapshot = async (outcome: Promise<SettingsWriteOutcome>): Promise<SettingsSnapshot> => {
  const result = await outcome;
  expect(result.kind).toBe('applied');
  if (result.kind !== 'applied') {
    throw new Error(`expected an applied write, got ${result.kind}`);
  }
  return result.snapshot;
};
