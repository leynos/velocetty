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
  } & SearchButtonColors
>;

const SearchButton = ({
  onClick,
  active,
  title,
  foregroundColor,
  backgroundColor,
  selectionColor,
  children
}: SearchButtonProps) => {
  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        onClick();
      }
    },
    [onClick]
  );

  const buttonVars: React.CSSProperties = {
    '--search-fg': foregroundColor,
    '--search-selection': selectionColor,
    '--search-hover-bg': backgroundColor
  };

  return (
    <div
      onClick={onClick}
      className={clsx(styles.searchButton, active && styles.searchButtonActive)}
      onKeyUp={handleKeyUp}
      style={buttonVars}
      title={title}
    >
      {children}
    </div>
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
    '--search-fg': foregroundColor,
    '--search-selection': selectionColor,
    '--search-hover-bg': borderColor,
    '--search-bg': backgroundColor,
    '--search-border': borderColor,
    '--search-font': font
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

        <SearchButton onClick={toggleCaseSensitive} active={caseSensitive} title="Match Case" {...searchButtonColors}>
          <VscCaseSensitive size="14px" />
        </SearchButton>

        <SearchButton onClick={toggleWholeWord} active={wholeWord} title="Match Whole Word" {...searchButtonColors}>
          <VscWholeWord size="14px" />
        </SearchButton>

        <SearchButton onClick={toggleRegex} active={regex} title="Use Regular Expression" {...searchButtonColors}>
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
