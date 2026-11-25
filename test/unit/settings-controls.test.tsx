/**
 * @file Keyboard and accessibility behaviour of the settings controls.
 *
 * Enter commits, Escape reverts, blur commits, and reset returns focus to the
 * control it reset. Errors are associated with the control through
 * `aria-describedby` and mark it invalid.
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, describe, expect, mock, test} from 'bun:test';

import {NumberField} from '../../lib/settings/components/controls/number-field';
import {keyHandlerFor, type FieldControlProps} from '../../lib/settings/components/controls/types';
import {SettingRow, type SettingRowProps} from '../../lib/settings/components/setting-row';
import {setupHappyDom} from '../testUtils/happy-dom';

let cleanup: (() => void) | null = null;
let root: Root | null = null;
let element: HTMLDivElement | null = null;

const baseProps = (overrides: Partial<SettingRowProps> = {}): SettingRowProps => ({
  id: 'core:fontSize',
  label: 'Font size',
  description: 'Text size in pixels.',
  control: {kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false},
  draft: '14',
  phase: 'idle',
  errors: [],
  isModified: false,
  isDisabled: false,
  isProfileOverridden: false,
  requiresRestart: false,
  onChange: () => {},
  onCommit: () => {},
  onRevert: () => {},
  onReset: () => {},
  ...overrides
});

const render = async (props: SettingRowProps): Promise<void> => {
  if (!root || !element) {
    element = document.createElement('div');
    document.body.append(element);
    root = createRoot(element);
  }
  await act(async () => {
    flushSync(() => {
      root?.render(React.createElement(SettingRow, props));
    });
  });
};

const input = (): HTMLInputElement => {
  const found = document.querySelector<HTMLInputElement>('input');
  if (found === null) {
    throw new Error('expected an input');
  }
  return found;
};

const controlProps = (overrides: Partial<FieldControlProps> = {}): FieldControlProps => ({
  controlId: 'core-fontSize-control',
  label: 'Font size',
  draft: '14',
  isDisabled: false,
  hasErrors: false,
  describedBy: '',
  onChange: () => {},
  onCommit: () => {},
  onRevert: () => {},
  ...overrides
});

const keyEvent = (key: string): KeyboardEvent =>
  new globalThis.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});

beforeEach(async () => {
  cleanup = await setupHappyDom();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  element = null;
  cleanup?.();
  cleanup = null;
});

describe('settings row controls', () => {
  test('Enter commits the draft and prevents the default action', () => {
    const commits: string[] = [];
    const event = keyEvent('Enter');
    keyHandlerFor(controlProps({onCommit: () => commits.push('commit')}))(event);
    expect(commits).toEqual(['commit']);
    expect(event.defaultPrevented).toBe(true);
  });

  test('Escape reverts the draft, prevents the default, and does not commit', () => {
    const calls: string[] = [];
    const event = keyEvent('Escape');
    keyHandlerFor(controlProps({onRevert: () => calls.push('revert'), onCommit: () => calls.push('commit')}))(event);
    expect(calls).toEqual(['revert']);
    expect(event.defaultPrevented).toBe(true);
  });

  test('leaving the field commits', () => {
    const onCommit = mock(() => {});
    const element = NumberField({
      ...controlProps({onCommit}),
      control: {kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false}
    });
    expect(element.props.onBlur).toBe(onCommit);
  });

  test('a toggle commits as soon as it changes', async () => {
    const drafts: string[] = [];
    let commits = 0;
    await render(
      baseProps({
        id: 'core:cursorBlink',
        label: 'Blink cursor',
        control: {kind: 'toggle'},
        draft: 'false',
        onChange: (draft) => drafts.push(draft),
        onCommit: () => {
          commits += 1;
        }
      })
    );
    const toggle = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      toggle?.dispatchEvent(new globalThis.window.MouseEvent('click', {bubbles: true}));
    });
    expect({drafts, commits}).toEqual({drafts: ['true'], commits: 1});
  });

  test('errors mark the control invalid and describe it', async () => {
    await render(baseProps({errors: ['Enter a number']}));
    const field = input();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('core-fontSize-errors');
    expect(document.body.textContent).toContain('Enter a number');
  });

  test('reset is labelled with the setting and returns focus to its control', async () => {
    const onReset = mock(() => {});
    await render(baseProps({isModified: true, onReset}));
    const reset = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Reset Font size to default'
    );
    expect(reset).toBeDefined();
    await act(async () => {
      reset?.dispatchEvent(new globalThis.window.MouseEvent('click', {bubbles: true}));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input());
  });

  test('a disabled row disables its control and explains why', async () => {
    await render(baseProps({isDisabled: true, disabledReason: 'Fix the other invalid settings first.'}));
    expect(input().disabled).toBe(true);
    expect(document.body.textContent).toContain('Fix the other invalid settings first.');
  });

  test('a restart-required change warns that a restart is needed', async () => {
    await render(baseProps({requiresRestart: true, isModified: true, draft: 'canary'}));
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('after restarting');
  });

  test('Tab moves from the control to the reset button', async () => {
    await render(baseProps({isModified: true}));
    const controls = [...document.querySelectorAll<HTMLElement>('input, button')];
    expect(controls.map((node) => node.tagName)).toEqual(['INPUT', 'BUTTON']);
  });
});
