/**
 * @file Shared stub factory for `../../lib/command-registry` module mocks.
 *
 * Provides a single `createCommandRegistryModuleStub` function that returns
 * the full mock shape expected by `mock.module('../../lib/command-registry',
 * ...)` call sites in Hyper component test suites. Centralising this stub
 * prevents duplicated inline shapes from drifting apart across test files.
 */

/** Returns the complete no-op stub shape for `createCommandRegistryModule`. */
export const createCommandRegistryModuleStub = () => ({
  register: () => {},
  update: () => {},
  remove: () => false,
  get: () => undefined,
  list: () => [],
  has: () => false,
  validateArgs: () => ({ok: true, value: undefined}),
  registerCommand: () => {},
  createCommand: () => {},
  updateCommand: () => {},
  replaceCommand: () => {},
  removeCommand: () => false,
  deleteCommand: () => false,
  getCommand: () => undefined,
  getCommandDefinition: () => undefined,
  listCommands: () => [],
  enumerateCommands: () => [],
  hasCommand: () => false,
  hasCommandDefinition: () => false,
  validateCommandArgs: () => ({ok: true, value: undefined}),
  validateCommandArgsFor: () => ({ok: true, value: undefined}),
  commandRegistry: {
    register: () => {},
    update: () => {},
    remove: () => false,
    get: () => undefined,
    list: () => [],
    has: () => false,
    validateArgs: () => ({ok: true, value: undefined})
  },
  getRegisteredKeys: async () => ({}),
  registerCommandHandlers: () => {},
  getCommandHandler: () => undefined
});
