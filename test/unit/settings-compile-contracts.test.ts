/**
 * @file Compile-time contracts the settings surface relies on.
 *
 * These are negative tests: each `@ts-expect-error` fails `make typecheck` if
 * the guarantee it pins ever weakens, even though every runtime assertion here
 * would stay green. `tsconfig.typecheck.json` includes `test/`, so the compiler
 * checks this file with the application.
 */
import {describe, expect, test} from 'bun:test';

import type {CoreSettingKey} from '@shared/settings/core-catalogue';
import {settingId, type SettingId} from '@shared/settings/panel-model';
import type {RendererEvents} from '@shared/types/common';

import type {settingLabels} from '../../lib/settings/i18n';

type MissingLabel = Exclude<CoreSettingKey, keyof typeof settingLabels>;
const everyKeyHasALabel: MissingLabel extends never ? true : false = true;

// @ts-expect-error A raw string is not a SettingId; the brand helper is required.
const unbranded: SettingId = 'core:fontSize';

// @ts-expect-error Every settings open request states whether it survives the initial session.
const requestWithoutFlag: RendererEvents['settings open req'] = {ignored: true};

const requestWithFlag: RendererEvents['settings open req'] = {keepThroughInitialSession: true};

describe('settings compile-time contracts', () => {
  test('every core setting has a label', () => {
    expect(everyKeyHasALabel).toBe(true);
  });

  test('SettingId is only constructed through the brand helper', () => {
    expect(unbranded).toBe(settingId('core:fontSize'));
  });

  test('the settings open request states whether it survives the initial session', () => {
    expect(requestWithoutFlag).toBeDefined();
    expect(requestWithFlag.keepThroughInitialSession).toBe(true);
  });
});
