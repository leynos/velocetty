/**
 * @file IPC handlers for the settings tab.
 *
 * The renderer is untrusted: every request is validated against the write
 * policy's key list and the JSON value contract before it reaches the service.
 * Following `app/clipboard.ts`, registration happens once at start-up so every
 * renderer can read a snapshot from first paint.
 */

import {ipcMain} from 'electron';
import {z} from 'zod';

import {isJsonValue, isString} from '../utils/runtime-guards';
import {isWritableSettingKey} from './settings-write-policy';

import type {SettingsService} from './settings-service';
import type {CoreSettingKey} from '@shared/settings/core-catalogue';
import type {SettingTarget, SettingsWriteOutcome} from '@shared/settings/protocol';
import type {JsonValue} from '@shared/types/json';
import type {IpcMainWithCommands} from '@shared/types/common';

const keySchema = z.custom<CoreSettingKey>((value) => isString(value) && isWritableSettingKey(value));
const targetSchema = z.object({scope: z.literal('core'), key: keySchema});
const valueSchema = z.custom<JsonValue>((value) => isJsonValue(value));

const invalidRequest = (detail: string): SettingsWriteOutcome => ({
  kind: 'failed',
  reason: 'not-editable',
  detail
});

/**
 * Registers the settings IPC handlers.
 *
 * @param service - The main-process settings authority.
 *
 * @example
 * registerSettingsIpcHandlers(createSettingsService(dependencies));
 */
export const registerSettingsIpcHandlers = (service: SettingsService): void => {
  // SAFETY: Electron's `ipcMain.handle` is the implementation behind this
  // interface; the cast only applies the shared command contract to it.
  const typedIpcMain = ipcMain as IpcMainWithCommands;

  typedIpcMain.handle('settings:getSnapshot', () => service.getSnapshot());

  typedIpcMain.handle('settings:setValue', async (_event, target: SettingTarget, value: JsonValue) => {
    const parsedTarget = targetSchema.safeParse(target);
    if (!parsedTarget.success) {
      return invalidRequest('The setting target is not editable.');
    }
    const parsedValue = valueSchema.safeParse(value);
    if (!parsedValue.success) {
      return invalidRequest('The value is not JSON.');
    }
    return service.setValue(parsedTarget.data, parsedValue.data);
  });

  typedIpcMain.handle('settings:resetValue', async (_event, target: SettingTarget) => {
    const parsedTarget = targetSchema.safeParse(target);
    if (!parsedTarget.success) {
      return invalidRequest('The setting target is not editable.');
    }
    return service.resetValue(parsedTarget.data);
  });
};
