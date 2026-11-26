/**
 * @file Render behaviour of the colour and select controls.
 *
 * These controls carry product rules that no other suite reaches: the swatch
 * and `data-hex` flag preview only valid colours, the select shows `(none)`
 * for the empty option, and a select commits as soon as it changes.
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, describe, expect, test} from 'bun:test';

import {ColourField} from '../../lib/settings/components/controls/colour-field';
import {SelectField} from '../../lib/settings/components/controls/select-field';
import type {FieldControlProps} from '../../lib/settings/components/controls/types';
import {setupHappyDom} from '../testUtils/happy-dom';

let cleanup: (() => void) | null = null;
let root: Root | null = null;
let element: HTMLDivElement | null = null;

const baseProps = (overrides: Partial<FieldControlProps> = {}): FieldControlProps => ({
  controlId: 'core-foregroundColor-control',
  label: 'Foreground colour',
  draft: '#aabbcc',
  isDisabled: false,
  hasErrors: false,
  describedBy: '',
  onChange: () => {},
  onCommit: () => {},
  onRevert: () => {},
  ...overrides
});

const render = async (node: React.ReactElement): Promise<void> => {
  if (element === null || root === null) {
    throw new Error('expected the test container');
  }
  await act(async () => {
    flushSync(() => {
      root?.render(node);
    });
  });
};

beforeEach(async () => {
  cleanup = await setupHappyDom();
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  element?.remove();
  cleanup?.();
  root = null;
  element = null;
  cleanup = null;
});

describe('ColourField', () => {
  test('a valid hex colour fills the swatch and marks the input as hex', async () => {
    await render(<ColourField {...baseProps({draft: '#abc'})} />);
    const input = document.querySelector('input');
    const swatch = document.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(input?.getAttribute('data-hex')).toBe('true');
    expect(swatch?.style.backgroundColor).toBe('#abc');
  });

  test('an invalid colour leaves the swatch transparent', async () => {
    await render(<ColourField {...baseProps({draft: 'red'})} />);
    const swatch = document.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(document.querySelector('input')?.getAttribute('data-hex')).toBe('false');
    expect(swatch?.style.backgroundColor).toBe('transparent');
  });

  test('typing reports the draft through onChange', () => {
    const drafts: string[] = [];
    const props = baseProps({onChange: (draft) => drafts.push(draft)});
    const children = React.Children.toArray(ColourField(props).props.children);
    const input = children.find(
      (child): child is React.ReactElement<{onChange: (event: {target: {value: string}}) => void}> =>
        // SAFETY: the component builds its input with an `id`, and React keeps
        // the props it was given, so reading `id` cannot see another shape.
        React.isValidElement(child) && (child.props as {id?: string}).id === props.controlId
    );
    input?.props.onChange({target: {value: '#123456'}});
    expect(drafts).toEqual(['#123456']);
  });
});

describe('SelectField', () => {
  const control = {kind: 'select' as const, options: ['', 'canary', 'stable']};

  test('the empty option is labelled (none)', async () => {
    await render(<SelectField {...baseProps({draft: 'stable'})} control={control} />);
    const options = [...document.querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toEqual(['(none)', 'canary', 'stable']);
  });

  test('a change reports the draft and commits immediately', () => {
    const drafts: string[] = [];
    let commits = 0;
    const element = SelectField({
      ...baseProps({draft: 'stable'}),
      control,
      onCommit: () => {
        commits += 1;
      },
      onChange: (draft) => drafts.push(draft)
    });
    // SAFETY: SelectField returns the element this test just built, so its
    // `onChange` is the handler supplied above.
    const props = element.props as {onChange: (event: {target: {value: string}}) => void};
    props.onChange({target: {value: 'canary'}});
    expect(drafts).toEqual(['canary']);
    expect(commits).toBe(1);
  });
});
