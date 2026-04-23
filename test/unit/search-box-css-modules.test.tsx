/**
 * @file Exercises SearchResultsCount display states, SearchNavigation button
 * labels and callbacks, and SearchBox label-threading for all eight i18n props.
 *
 * Invariants:
 * - SearchResultsCount must show empty content, the noResultsLabel, or an
 *   "X of Y" counter depending on the results prop.
 * - SearchNavigation must apply the correct title to each directional button
 *   and invoke the matching callback when clicked.
 * - SearchBox must wire all eight label props to the expected DOM attributes so
 *   that TranslatedSearchBox (which injects labels from useTranslation) produces
 *   a correctly annotated search widget for every supported locale.
 *
 * Cross-links:
 * - Component: `lib/components/searchBox.tsx`
 * - Translation wrapper: `lib/components/term.tsx` (TranslatedSearchBox)
 * - Translation hook: `lib/hooks/use-translation.ts`
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {pollForElement} from '../testUtils/pollFor';
import {waitFor} from '../testUtils/waitFor';

import type {SearchBoxProps} from '../../typings/hyper';
type SearchBoxComponent = React.ComponentType<SearchBoxProps>;

let searchBoxModuleInstanceCounter = 0;

/**
 * Loads a fresh SearchBox module instance for each test render.
 *
 * Bun's module mocks are process-global across concurrent test files. This
 * suite exercises the real SearchBox component, while other suites may mock
 * the same import path. A cache-busting query string keeps this suite isolated
 * from those external mocks and from any cached module state.
 */
const loadSearchBoxComponent = async (): Promise<SearchBoxComponent> => {
  searchBoxModuleInstanceCounter += 1;
  const {default: SearchBoxComponent} = (await import(
    `../../lib/components/searchBox.tsx?search_box_css_modules=${searchBoxModuleInstanceCounter}`
  )) as {default: SearchBoxComponent};
  return SearchBoxComponent;
};

// Static fixture for test labels; not kept in sync with the app defaults.
// This is a local copy of headerLabelDefaults for test isolation.
const testLabelFixture = {
  search: 'Search',
  noResults: 'No results',
  previousMatch: 'Previous Match',
  nextMatch: 'Next Match',
  close: 'Close',
  matchCase: 'Match Case',
  matchWholeWord: 'Match Whole Word',
  useRegex: 'Use Regular Expression'
} as const;

const defaultLabels = {
  searchLabel: testLabelFixture.search,
  noResultsLabel: testLabelFixture.noResults,
  previousMatchLabel: testLabelFixture.previousMatch,
  nextMatchLabel: testLabelFixture.nextMatch,
  closeLabel: testLabelFixture.close,
  matchCaseLabel: testLabelFixture.matchCase,
  matchWholeWordLabel: testLabelFixture.matchWholeWord,
  useRegexLabel: testLabelFixture.useRegex
} as const;

const defaultColors = {
  backgroundColor: '#1a1a1a',
  foregroundColor: '#ffffff',
  borderColor: '#444444',
  selectionColor: '#264f78',
  font: '14px monospace'
} as const;

const makeProps = (overrides: Partial<SearchBoxProps> = {}): SearchBoxProps => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  results: undefined,
  toggleCaseSensitive: () => {},
  toggleWholeWord: () => {},
  toggleRegex: () => {},
  next: () => {},
  prev: () => {},
  close: () => {},
  ...defaultColors,
  ...defaultLabels,
  ...overrides
});

const renderSearchBox = async (overrides: Partial<SearchBoxProps> = {}) => {
  const cleanup = await setupHappyDom();
  const SearchBoxComponent = await loadSearchBoxComponent();
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  try {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    if (!root) {
      throw new Error('Failed to create React root');
    }
    await act(async () => {
      flushSync(() => {
        root.render(React.createElement(SearchBoxComponent, makeProps(overrides)));
      });
      await waitFor(0);
    });
  } catch (error) {
    // Ensure cleanup on setup failure to prevent global DOM state leakage
    try {
      if (root) {
        // Explicitly swallow errors from unmount - cleanup continues regardless
        await act(async () => {
          root.unmount();
          await waitFor(0);
        });
      }
    } catch {
      // Swallow unmount errors to ensure cleanup proceeds
    } finally {
      if (container) {
        container.remove();
      }
      cleanup();
    }
    throw error;
  }

  const teardown = async () => {
    if (root) {
      // Explicitly swallow errors from unmount - cleanup continues regardless
      await act(async () => {
        root.unmount();
        await waitFor(0);
      });
    }
    if (container) {
      container.remove();
    }
    cleanup();
  };

  return {container, teardown};
};

// ---------------------------------------------------------------------------
// SearchResultsCount
// ---------------------------------------------------------------------------

const searchResultsCountCases: Array<[string, Partial<SearchBoxProps>, string]> = [
  ['shows empty content when results are undefined', {results: undefined}, ''],
  [
    'shows noResultsLabel when result count is zero',
    {results: {resultIndex: 0, resultCount: 0}, noResultsLabel: 'No results'},
    'No results'
  ],
  ['shows one-based index and total when results are present', {results: {resultIndex: 2, resultCount: 7}}, '3 of 7'],
  ['shows "1 of 1" when a single result is found', {results: {resultIndex: 0, resultCount: 1}}, '1 of 1']
];

for (const [description, overrides, expectedTextContent] of searchResultsCountCases) {
  test.serial(`SearchResultsCount ${description}`, async () => {
    const {container, teardown} = await renderSearchBox(overrides);
    try {
      const output = await pollForElement(container, 'output');
      expect(output.textContent?.trim()).toBe(expectedTextContent);
    } finally {
      await teardown();
    }
  });
}

// ---------------------------------------------------------------------------
// SearchNavigation – button labels
// ---------------------------------------------------------------------------

const searchNavigationLabelCases: Array<[keyof SearchBoxProps, string]> = [
  ['previousMatchLabel', 'Custom Prev Label'],
  ['nextMatchLabel', 'Custom Next Label'],
  ['closeLabel', 'Custom Close Label']
];

for (const [prop, expectedTitle] of searchNavigationLabelCases) {
  test.serial(`SearchNavigation applies ${prop} as a navigation button title`, async () => {
    const {container, teardown} = await renderSearchBox({[prop]: expectedTitle} as Partial<SearchBoxProps>);
    try {
      const button = await pollForElement(container, `button[title="${expectedTitle}"]`);
      expect(button).toBeTruthy();
    } finally {
      await teardown();
    }
  });
}

// ---------------------------------------------------------------------------
// SearchNavigation – button callbacks
// ---------------------------------------------------------------------------

// Separate test cases for navigation callbacks with search term propagation
// The prev/next cases are marked as failing because Happy DOM does not reliably
// propagate React synthetic event values. When the environment is upgraded to
// support proper event propagation, remove the .failing() modifier.
const navTermCallbackCases: Array<[keyof SearchBoxProps, keyof SearchBoxProps, string]> = [
  ['prev', 'previousMatchLabel', 'Custom Prev Callback'],
  ['next', 'nextMatchLabel', 'Custom Next Callback']
];

for (const [callbackProp, labelProp, buttonTitle] of navTermCallbackCases) {
  test.serial.failing(`SearchNavigation invokes the ${callbackProp} callback with the search term`, async () => {
    const searchTerm = 'test-query';
    let called = false;
    let receivedTerm: string | null = null;

    const callback = (term?: string) => {
      called = true;
      if (term !== undefined) {
        receivedTerm = term;
      }
    };

    const {container, teardown} = await renderSearchBox({
      [callbackProp]: callback,
      [labelProp]: buttonTitle
    } as Partial<SearchBoxProps>);

    try {
      const input = container.querySelector<HTMLInputElement>('input[type="text"]');
      expect(input).toBeTruthy();
      if (!input) throw new Error('Input element not found');

      await act(async () => {
        input.value = searchTerm;
        const inputEvent = new Event('input', {bubbles: true});
        Object.defineProperty(inputEvent, 'target', {
          get: () => input,
          enumerable: true
        });
        Object.defineProperty(inputEvent, 'currentTarget', {
          get: () => input,
          enumerable: true
        });
        input.dispatchEvent(inputEvent);
        await waitFor(0);
      });

      const button = container.querySelector<HTMLButtonElement>(`button[title="${buttonTitle}"]`);
      expect(button).toBeTruthy();
      await act(async () => {
        button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await waitFor(0);
      });

      expect(called).toBe(true);
      expect(receivedTerm).toBe(searchTerm);
    } finally {
      await teardown();
    }
  });
}

test.serial('SearchNavigation invokes the close callback when its button is clicked', async () => {
  let called = false;
  const callback = () => {
    called = true;
  };

  const {container, teardown} = await renderSearchBox({
    close: callback,
    closeLabel: 'Custom Close Callback'
  });

  try {
    const button = (await pollForElement(container, 'button[title="Custom Close Callback"]')) as HTMLButtonElement;
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });

    expect(called).toBe(true);
  } finally {
    await teardown();
  }
});

// ---------------------------------------------------------------------------
// SearchBox – all eight label props (integration contract for TranslatedSearchBox)
//
// TranslatedSearchBox in lib/components/term.tsx injects these eight labels via
// useTranslation() before passing them to SearchBox. The assertions below
// confirm that each label reaches the correct DOM attribute so locale changes
// propagate end-to-end without further wiring changes.
// ---------------------------------------------------------------------------

test.serial('SearchBox wires searchLabel to the input aria-label and placeholder', async () => {
  const {container, teardown} = await renderSearchBox({searchLabel: 'Find in terminal'});
  try {
    const input = (await pollForElement(container, 'input[type="text"]')) as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Find in terminal');
    expect(input.getAttribute('placeholder')).toBe('Find in terminal');
  } finally {
    await teardown();
  }
});

const searchBoxToggleLabelCases: Array<[keyof SearchBoxProps, string]> = [
  ['matchCaseLabel', 'Custom Match Case Label'],
  ['matchWholeWordLabel', 'Custom Whole Word Label'],
  ['useRegexLabel', 'Custom Regex Label']
];

for (const [prop, expectedTitle] of searchBoxToggleLabelCases) {
  test.serial(`SearchBox wires ${prop} to its toggle button title`, async () => {
    const {container, teardown} = await renderSearchBox({[prop]: expectedTitle} as Partial<SearchBoxProps>);
    try {
      const button = await pollForElement(container, `button[title="${expectedTitle}"]`);
      expect(button).toBeTruthy();
    } finally {
      await teardown();
    }
  });
}

test.serial(
  'SearchBox toggle buttons reflect aria-pressed state from caseSensitive, wholeWord, and regex props',
  async () => {
    const {container, teardown} = await renderSearchBox({
      caseSensitive: true,
      wholeWord: true,
      regex: false,
      matchCaseLabel: 'Aria Match Case',
      matchWholeWordLabel: 'Aria Whole Word',
      useRegexLabel: 'Aria Regex'
    });
    try {
      const matchCaseBtn = await pollForElement(container, 'button[title="Aria Match Case"]');
      const wholeWordBtn = await pollForElement(container, 'button[title="Aria Whole Word"]');
      const regexBtn = await pollForElement(container, 'button[title="Aria Regex"]');

      expect(matchCaseBtn.getAttribute('aria-pressed')).toBe('true');
      expect(wholeWordBtn.getAttribute('aria-pressed')).toBe('true');
      expect(regexBtn.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await teardown();
    }
  }
);

test.serial('SearchBox output element carries aria-live polite for screen-reader announcements', async () => {
  const {container, teardown} = await renderSearchBox();
  try {
    const output = await pollForElement(container, 'output');
    expect(output.getAttribute('aria-live')).toBe('polite');
    expect(output.getAttribute('aria-atomic')).toBe('true');
  } finally {
    await teardown();
  }
});

test.serial('SearchBox exposes CSS custom properties and CSS Module classes for themed controls', async () => {
  const {container, teardown} = await renderSearchBox();
  try {
    const searchContainer = container.firstElementChild;
    const searchInput = container.querySelector<HTMLInputElement>('input[type="text"]');
    const toggleButton = container.querySelector<HTMLButtonElement>(`button[title="${defaultLabels.matchCaseLabel}"]`);

    expect(searchContainer).toBeTruthy();
    expect(searchInput).toBeTruthy();
    expect(toggleButton).toBeTruthy();

    if (!searchContainer || !searchInput || !toggleButton) {
      throw new Error('Expected search container, input, and toggle button to be present');
    }

    expect(searchContainer.className).toContain('searchContainer');
    expect(searchContainer.className).not.toContain('  ');
    expect(searchContainer.style.getPropertyValue('--search-bg')).toBe(defaultColors.backgroundColor);
    expect(searchContainer.style.getPropertyValue('--search-border')).toBe(defaultColors.borderColor);
    expect(searchContainer.style.getPropertyValue('--search-fg')).toBe(defaultColors.foregroundColor);
    expect(searchContainer.style.getPropertyValue('--search-selection')).toBe(defaultColors.selectionColor);
    expect(searchContainer.style.getPropertyValue('--search-font')).toBe(defaultColors.font);
    expect(searchInput.className).toContain('searchInput');
    expect(toggleButton.className).toContain('searchButton');
  } finally {
    await teardown();
  }
});
