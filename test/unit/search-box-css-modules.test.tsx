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
import {waitFor} from '../testUtils/waitFor';

import type {SearchBoxProps} from '../../typings/hyper';

type SearchBoxComponent = typeof import('../../lib/components/searchBox').default;

let SearchBox: SearchBoxComponent;
let moduleCounter = 0;

const loadSearchBox = async (): Promise<SearchBoxComponent> => {
  moduleCounter += 1;
  const mod = (await import(`../../lib/components/searchBox.tsx?search_box_css_modules=${moduleCounter}`)) as {
    default: SearchBoxComponent;
  };
  return mod.default;
};

const defaultLabels = {
  searchLabel: 'Search',
  noResultsLabel: 'No results',
  previousMatchLabel: 'Previous Match',
  nextMatchLabel: 'Next Match',
  closeLabel: 'Close',
  matchCaseLabel: 'Match Case',
  matchWholeWordLabel: 'Match Whole Word',
  useRegexLabel: 'Use Regular Expression'
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
  SearchBox = await loadSearchBox();

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    flushSync(() => {
      root.render(React.createElement(SearchBox, makeProps(overrides)));
    });
    await waitFor(0);
  });

  const teardown = async () => {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    container.remove();
    cleanup();
  };

  return {container, teardown};
};

// ---------------------------------------------------------------------------
// SearchResultsCount
// ---------------------------------------------------------------------------

test('SearchResultsCount shows empty content when results are undefined', async () => {
  const {container, teardown} = await renderSearchBox({results: undefined});
  try {
    const output = container.querySelector('output');
    expect(output).toBeTruthy();
    expect(output?.textContent?.trim()).toBe('');
  } finally {
    await teardown();
  }
});

test('SearchResultsCount shows noResultsLabel when result count is zero', async () => {
  const {container, teardown} = await renderSearchBox({
    results: {resultIndex: 0, resultCount: 0},
    noResultsLabel: 'No results'
  });
  try {
    const output = container.querySelector('output');
    expect(output?.textContent).toBe('No results');
  } finally {
    await teardown();
  }
});

test('SearchResultsCount shows one-based index and total when results are present', async () => {
  const {container, teardown} = await renderSearchBox({
    results: {resultIndex: 2, resultCount: 7}
  });
  try {
    const output = container.querySelector('output');
    expect(output?.textContent).toBe('3 of 7');
  } finally {
    await teardown();
  }
});

test('SearchResultsCount shows "1 of 1" when a single result is found', async () => {
  const {container, teardown} = await renderSearchBox({
    results: {resultIndex: 0, resultCount: 1}
  });
  try {
    const output = container.querySelector('output');
    expect(output?.textContent).toBe('1 of 1');
  } finally {
    await teardown();
  }
});

// ---------------------------------------------------------------------------
// SearchNavigation – button labels
// ---------------------------------------------------------------------------

test('SearchNavigation applies previousMatchLabel as the Previous button title', async () => {
  const {container, teardown} = await renderSearchBox({previousMatchLabel: 'Previous Match'});
  try {
    const button = container.querySelector('button[title="Previous Match"]');
    expect(button).toBeTruthy();
  } finally {
    await teardown();
  }
});

test('SearchNavigation applies nextMatchLabel as the Next button title', async () => {
  const {container, teardown} = await renderSearchBox({nextMatchLabel: 'Next Match'});
  try {
    const button = container.querySelector('button[title="Next Match"]');
    expect(button).toBeTruthy();
  } finally {
    await teardown();
  }
});

test('SearchNavigation applies closeLabel as the Close button title', async () => {
  const {container, teardown} = await renderSearchBox({closeLabel: 'Close'});
  try {
    const button = container.querySelector('button[title="Close"]');
    expect(button).toBeTruthy();
  } finally {
    await teardown();
  }
});

// ---------------------------------------------------------------------------
// SearchNavigation – button callbacks
// ---------------------------------------------------------------------------

test('SearchNavigation invokes the prev callback when the Previous button is clicked', async () => {
  let prevCalled = false;
  const {container, teardown} = await renderSearchBox({
    prev: () => {
      prevCalled = true;
    }
  });
  try {
    const button = container.querySelector<HTMLButtonElement>('button[title="Previous Match"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });
    expect(prevCalled).toBe(true);
  } finally {
    await teardown();
  }
});

test('SearchNavigation invokes the next callback when the Next button is clicked', async () => {
  let nextCalled = false;
  const {container, teardown} = await renderSearchBox({
    next: () => {
      nextCalled = true;
    }
  });
  try {
    const button = container.querySelector<HTMLButtonElement>('button[title="Next Match"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });
    expect(nextCalled).toBe(true);
  } finally {
    await teardown();
  }
});

test('SearchNavigation invokes the close callback when the Close button is clicked', async () => {
  let closeCalled = false;
  const {container, teardown} = await renderSearchBox({
    close: () => {
      closeCalled = true;
    }
  });
  try {
    const button = container.querySelector<HTMLButtonElement>('button[title="Close"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });
    expect(closeCalled).toBe(true);
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

test('SearchBox wires searchLabel to the input aria-label and placeholder', async () => {
  const {container, teardown} = await renderSearchBox({searchLabel: 'Find in terminal'});
  try {
    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input?.getAttribute('aria-label')).toBe('Find in terminal');
    expect(input?.getAttribute('placeholder')).toBe('Find in terminal');
  } finally {
    await teardown();
  }
});

test('SearchBox wires matchCaseLabel to the Match Case toggle button title', async () => {
  const {container, teardown} = await renderSearchBox({matchCaseLabel: 'Match Case'});
  try {
    const button = container.querySelector('button[title="Match Case"]');
    expect(button).toBeTruthy();
  } finally {
    await teardown();
  }
});

test('SearchBox wires matchWholeWordLabel to the Match Whole Word toggle button title', async () => {
  const {container, teardown} = await renderSearchBox({matchWholeWordLabel: 'Match Whole Word'});
  try {
    const button = container.querySelector('button[title="Match Whole Word"]');
    expect(button).toBeTruthy();
  } finally {
    await teardown();
  }
});

test('SearchBox wires useRegexLabel to the Use Regular Expression toggle button title', async () => {
  const {container, teardown} = await renderSearchBox({useRegexLabel: 'Use Regular Expression'});
  try {
    const button = container.querySelector('button[title="Use Regular Expression"]');
    expect(button).toBeTruthy();
  } finally {
    await teardown();
  }
});

test('SearchBox toggle buttons reflect aria-pressed state from caseSensitive, wholeWord, and regex props', async () => {
  const {container, teardown} = await renderSearchBox({
    caseSensitive: true,
    wholeWord: true,
    regex: false
  });
  try {
    const matchCaseBtn = container.querySelector<HTMLButtonElement>('button[title="Match Case"]');
    const wholeWordBtn = container.querySelector<HTMLButtonElement>('button[title="Match Whole Word"]');
    const regexBtn = container.querySelector<HTMLButtonElement>('button[title="Use Regular Expression"]');

    expect(matchCaseBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(wholeWordBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(regexBtn?.getAttribute('aria-pressed')).toBe('false');
  } finally {
    await teardown();
  }
});

test('SearchBox output element carries aria-live polite for screen-reader announcements', async () => {
  const {container, teardown} = await renderSearchBox();
  try {
    const output = container.querySelector('output');
    expect(output?.getAttribute('aria-live')).toBe('polite');
    expect(output?.getAttribute('aria-atomic')).toBe('true');
  } finally {
    await teardown();
  }
});
