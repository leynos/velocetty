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
import styles from './searchBox.module.css';

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

const SearchBox = forwardRef(function SearchBox(props: SearchBoxProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const {
    caseSensitive,
    wholeWord,
    regex,
    results,
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

  const handleChange = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      searchTermRef.current = event.currentTarget.value;
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
    <div className={`${styles.flexRow} ${styles.searchContainer}`} ref={ref} style={searchVars}>
      <div className={`${styles.flexRow} ${styles.searchBox}`}>
        <input
          className={styles.searchInput}
          type="text"
          onKeyDown={handleChange}
          ref={inputRef}
          placeholder="Search"
        />

        <SearchButton
          onClick={toggleCaseSensitive}
          active={caseSensitive}
          pressed={caseSensitive}
          title="Match Case"
          {...searchButtonColors}
        >
          <VscCaseSensitive size="14px" />
        </SearchButton>

        <SearchButton
          onClick={toggleWholeWord}
          active={wholeWord}
          pressed={wholeWord}
          title="Match Whole Word"
          {...searchButtonColors}
        >
          <VscWholeWord size="14px" />
        </SearchButton>

        <SearchButton
          onClick={toggleRegex}
          active={regex}
          pressed={regex}
          title="Use Regular Expression"
          {...searchButtonColors}
        >
          <VscRegex size="14px" />
        </SearchButton>
      </div>

      <span style={{minWidth: '60px', marginLeft: '4px'}}>
        {results === undefined
          ? ''
          : results.resultCount === 0
            ? 'No results'
            : `${results.resultIndex + 1} of ${results.resultCount}`}
      </span>

      <div className={styles.flexRow}>
        <SearchButton
          onClick={() => prev(searchTermRef.current)}
          active={false}
          title="Previous Match"
          {...searchButtonColors}
        >
          <VscArrowUp size="14px" />
        </SearchButton>

        <SearchButton
          onClick={() => next(searchTermRef.current)}
          active={false}
          title="Next Match"
          {...searchButtonColors}
        >
          <VscArrowDown size="14px" />
        </SearchButton>

        <SearchButton onClick={close} active={false} title="Close" {...searchButtonColors}>
          <VscClose size="14px" />
        </SearchButton>
      </div>
    </div>
  );
});

SearchBox.displayName = 'SearchBox';

export default SearchBox;
