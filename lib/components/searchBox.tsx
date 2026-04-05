/** @file Search box component for find-in-page functionality with case sensitivity, whole word, and regex toggles. */
import type React from 'react';
import {useCallback, useRef, useEffect, forwardRef} from 'react';

import {VscArrowDown} from '@react-icons/all-files/vsc/VscArrowDown';
import {VscArrowUp} from '@react-icons/all-files/vsc/VscArrowUp';
import {VscCaseSensitive} from '@react-icons/all-files/vsc/VscCaseSensitive';
import {VscClose} from '@react-icons/all-files/vsc/VscClose';
import {VscRegex} from '@react-icons/all-files/vsc/VscRegex';
import {VscWholeWord} from '@react-icons/all-files/vsc/VscWholeWord';
import clsx from 'clsx';

import type {SearchBoxProps} from '../../typings/hyper';
import * as styles from './searchBox.module.css';

type SearchButtonColors = {
  foregroundColor: string;
  selectionColor: string;
  backgroundColor: string;
};

type SearchButtonProps = React.PropsWithChildren<
  {
    onClick: () => void;
    active: boolean;
    title: string;
    'aria-label'?: string;
    pressed?: boolean;
  } & SearchButtonColors
>;

const SearchButton = ({
  onClick,
  active,
  title,
  'aria-label': ariaLabel,
  pressed,
  foregroundColor,
  backgroundColor,
  selectionColor,
  children
}: SearchButtonProps) => {
  const buttonVars: React.CSSProperties = {
    ['--search-fg' as string]: foregroundColor,
    ['--search-selection' as string]: selectionColor,
    ['--search-hover-bg' as string]: backgroundColor
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(styles.searchButton, active && styles.searchButtonActive)}
      style={buttonVars}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
};

type SearchResultsCountProps = {
  results: SearchBoxProps['results'];
  noResultsLabel: string;
};

const SearchResultsCount = ({results, noResultsLabel}: SearchResultsCountProps) => (
  <output style={{minWidth: '60px', marginLeft: '4px'}} aria-live="polite" aria-atomic="true">
    {results === undefined
      ? ''
      : results.resultCount === 0
        ? noResultsLabel
        : `${results.resultIndex + 1} of ${results.resultCount}`}
  </output>
);

type SearchNavigationProps = {
  prev: SearchBoxProps['prev'];
  next: SearchBoxProps['next'];
  close: SearchBoxProps['close'];
  searchTermRef: React.RefObject<string>;
  previousMatchLabel: string;
  nextMatchLabel: string;
  closeLabel: string;
} & SearchButtonColors;

const SearchNavigation = ({
  prev,
  next,
  close,
  searchTermRef,
  foregroundColor,
  backgroundColor,
  selectionColor,
  previousMatchLabel,
  nextMatchLabel,
  closeLabel
}: SearchNavigationProps) => (
  <div className="flex flex-row justify-between items-center gap-1">
    <SearchButton
      onClick={() => prev(searchTermRef.current)}
      active={false}
      title={previousMatchLabel}
      foregroundColor={foregroundColor}
      backgroundColor={backgroundColor}
      selectionColor={selectionColor}
    >
      <VscArrowUp size="14px" />
    </SearchButton>

    <SearchButton
      onClick={() => next(searchTermRef.current)}
      active={false}
      title={nextMatchLabel}
      foregroundColor={foregroundColor}
      backgroundColor={backgroundColor}
      selectionColor={selectionColor}
    >
      <VscArrowDown size="14px" />
    </SearchButton>

    <SearchButton
      onClick={close}
      active={false}
      title={closeLabel}
      foregroundColor={foregroundColor}
      backgroundColor={backgroundColor}
      selectionColor={selectionColor}
    >
      <VscClose size="14px" />
    </SearchButton>
  </div>
);

const SearchBox = forwardRef(function SearchBox(props: SearchBoxProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const {
    caseSensitive,
    wholeWord,
    regex,
    results,
    searchLabel,
    noResultsLabel,
    previousMatchLabel,
    nextMatchLabel,
    closeLabel,
    matchCaseLabel,
    matchWholeWordLabel,
    useRegexLabel,
    toggleCaseSensitive,
    toggleWholeWord,
    toggleRegex,
    next,
    prev,
    close,
    backgroundColor,
    foregroundColor,
    borderColor,
    selectionColor,
    font
  } = props;

  const searchTermRef = useRef<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const updateSearch = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    searchTermRef.current = event.currentTarget.value;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.shiftKey && event.key === 'Enter') {
        prev(searchTermRef.current);
      } else if (event.key === 'Enter') {
        next(searchTermRef.current);
      }
    },
    [prev, next]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const searchButtonColors: SearchButtonColors = {
    backgroundColor: borderColor,
    selectionColor,
    foregroundColor
  };

  const searchVars: React.CSSProperties = {
    ['--search-fg' as string]: foregroundColor,
    ['--search-selection' as string]: selectionColor,
    ['--search-hover-bg' as string]: borderColor,
    ['--search-bg' as string]: backgroundColor,
    ['--search-border' as string]: borderColor,
    ['--search-font' as string]: font
  };

  return (
    <div
      className={`flex flex-row justify-between items-center gap-1 ${styles.searchContainer}`}
      ref={ref}
      style={searchVars}
    >
      <div className={`flex flex-row justify-between items-center gap-1 ${styles.searchBox}`}>
        <input
          className={styles.searchInput}
          type="text"
          aria-label={searchLabel}
          onChange={updateSearch}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          placeholder={searchLabel}
        />

        <SearchButton
          onClick={toggleCaseSensitive}
          active={caseSensitive}
          pressed={caseSensitive}
          title={matchCaseLabel}
          {...searchButtonColors}
        >
          <VscCaseSensitive size="14px" />
        </SearchButton>

        <SearchButton
          onClick={toggleWholeWord}
          active={wholeWord}
          pressed={wholeWord}
          title={matchWholeWordLabel}
          {...searchButtonColors}
        >
          <VscWholeWord size="14px" />
        </SearchButton>

        <SearchButton
          onClick={toggleRegex}
          active={regex}
          pressed={regex}
          title={useRegexLabel}
          {...searchButtonColors}
        >
          <VscRegex size="14px" />
        </SearchButton>
      </div>

      <SearchResultsCount results={results} noResultsLabel={noResultsLabel} />

      <SearchNavigation
        prev={prev}
        next={next}
        close={close}
        searchTermRef={searchTermRef}
        previousMatchLabel={previousMatchLabel}
        nextMatchLabel={nextMatchLabel}
        closeLabel={closeLabel}
        {...searchButtonColors}
      />
    </div>
  );
});

SearchBox.displayName = 'SearchBox';

export default SearchBox;