/**
 * @file Behavioural scenarios for the settings view.
 *
 * The view is pure, so these render it with fixed props and assert what a user
 * sees: focus lands in the search box, the current category is marked, the
 * empty state offers one clear action, and the live region announces counts.
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, describe, expect, test} from 'bun:test';

import {SettingsView, type SettingsViewProps} from '../../lib/settings/components/settings-view';
import {setupHappyDom} from '../testUtils/happy-dom';

let cleanup: (() => void) | null = null;
let root: Root | null = null;
let element: HTMLDivElement | null = null;

const strings: SettingsViewProps['strings'] = {
  title: 'Settings',
  search: 'Search settings',
  searchPlaceholder: 'Search settings',
  categories: 'Settings categories',
  results: 'Settings results',
  noResults: 'No settings match',
  clearFilters: 'Clear search and category',
  openConfigFile: 'Open config file',
  modified: 'Changed'
};

const row = (
  overrides: Partial<SettingsViewProps['sections'][number]['rows'][number]>
): SettingsViewProps['sections'][number]['rows'][number] => ({
  id: 'core:fontSize',
  label: 'Font size',
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

const baseProps: SettingsViewProps = {
  strings,
  sections: [
    {
      category: 'appearance',
      label: 'Appearance',
      rows: [row({id: 'core:fontSize', label: 'Font size', description: 'Text size.', draft: '14', isModified: true})]
    }
  ],
  categories: [
    {id: 'all', label: 'All settings', count: 1},
    {id: 'appearance', label: 'Appearance', count: 1}
  ],
  query: '',
  selectedCategory: 'all',
  resultCount: 1,
  statusMessage: '2 settings',
  banner: null,
  isActive: true,
  onQueryChange: () => {},
  onCategorySelect: () => {},
  onClearFilters: () => {},
  onOpenConfigFile: () => {}
};

const render = async (overrides: Partial<SettingsViewProps>): Promise<void> => {
  if (!root || !element) {
    element = document.createElement('div');
    document.body.append(element);
    root = createRoot(element);
  }
  await act(async () => {
    flushSync(() => {
      root?.render(React.createElement(SettingsView, {...baseProps, ...overrides}));
    });
  });
};

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

describe('settings view', () => {
  test('focuses the search box when the surface becomes active', async () => {
    await render({isActive: true});
    const search = document.querySelector('input[type="search"]');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
  });

  test('does not steal focus while the surface is inactive', async () => {
    await render({isActive: false});
    expect(document.activeElement).not.toBe(document.querySelector('input[type="search"]'));
  });

  test('marks the selected category current', async () => {
    await render({selectedCategory: 'appearance'});
    const current = [...document.querySelectorAll('[aria-current="true"]')].map((node) => node.textContent);
    expect(current).toEqual(['Appearance1']);
  });

  test('renders rows with values and modified markers', async () => {
    await render({});
    expect(document.body.textContent).toContain('Font size');
    const input = document.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input?.value).toBe('14');
    const reset = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Reset Font size to default'
    );
    expect(reset).toBeDefined();
  });

  test('the empty state offers one clear action', async () => {
    let cleared = 0;
    await render({
      sections: [],
      resultCount: 0,
      statusMessage: '0 settings',
      onClearFilters: () => {
        cleared += 1;
      }
    });
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Clear search and category'
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new globalThis.window.MouseEvent('click', {bubbles: true}));
    });
    expect(cleared).toBe(1);
  });

  test('announces the result count politely', async () => {
    await render({statusMessage: '7 settings'});
    const status = document.querySelector('output');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe('7 settings');
  });

  test('shows a file-status banner when given one', async () => {
    await render({banner: 'The config file has a syntax error.'});
    expect(document.querySelector('[role="note"]')?.textContent).toBe('The config file has a syntax error.');
  });
});
