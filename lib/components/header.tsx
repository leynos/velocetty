/** @file Renders the header UI with window controls, hamburger menu, and Tabs composition. */
import type React from 'react';
import {forwardRef, useState} from 'react';

import type {HeaderProps} from '../../typings/hyper';
import {decorate, getTabsProps} from '../utils/plugins';

import Tabs_ from './tabs';
import * as styles from './header.module.css';

const Tabs = decorate(Tabs_, 'Tabs');

const Header = forwardRef(function Header(props: HeaderProps, ref: React.ForwardedRef<HTMLElement>) {
  const [headerMouseDownWindowX, setHeaderMouseDownWindowX] = useState<number>(0);
  const [headerMouseDownWindowY, setHeaderMouseDownWindowY] = useState<number>(0);

  const onChangeIntent = (active: string) => {
    // we ignore clicks if they're a byproduct of a drag
    // motion to move the window
    if (window.screenX !== headerMouseDownWindowX || window.screenY !== headerMouseDownWindowY) {
      return;
    }

    props.onChangeTab(active);
  };

  const handleHeaderMouseDown = () => {
    // the hack of all hacks, this prevents the term
    // iframe from losing focus, for example, when
    // the user drags the nav around
    // Fixed by calling window.focusActiveTerm(), thus we can support drag tab
    // ev.preventDefault();

    // persist start positions of a potential drag motion
    // to differentiate dragging from clicking
    setHeaderMouseDownWindowX(window.screenX);
    setHeaderMouseDownWindowY(window.screenY);
  };

  const handleHamburgerMenuClick = (event: React.MouseEvent) => {
    let {right: x, bottom: y} = event.currentTarget.getBoundingClientRect();
    x -= 15; // to compensate padding
    y -= 12; // ^ same
    props.openHamburgerMenu({x, y});
  };

  const handleMaximizeClick = () => {
    if (props.maximized) {
      props.unmaximize();
    } else {
      props.maximize();
    }
  };

  const handleMinimizeClick = () => {
    props.minimize();
  };

  const handleCloseClick = () => {
    props.close();
  };

  const getWindowHeaderConfig = () => {
    const {showHamburgerMenu, showWindowControls} = props;

    const defaults = {
      hambMenu: !props.isMac, // show by default on windows and linux
      winCtrls: !props.isMac // show by default on Windows and Linux
    };

    // don't allow the user to change defaults on macOS
    if (props.isMac) {
      return defaults;
    }

    return {
      hambMenu: showHamburgerMenu === '' ? defaults.hambMenu : showHamburgerMenu,
      winCtrls: showWindowControls === '' ? defaults.winCtrls : showWindowControls
    };
  };

  const {isMac} = props;
  const {borderColor} = props;
  let title = 'Hyper';
  if (props.tabs.length === 1 && props.tabs[0].title) {
    // if there's only one tab we use its title as the window title
    title = props.tabs[0].title;
  }
  const {hambMenu, winCtrls} = getWindowHeaderConfig();
  const left = winCtrls === 'left';
  const maxButtonHref = props.maximized
    ? './renderer/assets/icons.svg#restore-window'
    : './renderer/assets/icons.svg#maximize-window';

  return (
    <header
      className={`${styles.headerHeader} ${isMac ? styles.headerHeaderRounded : ''}`}
      onMouseDown={handleHeaderMouseDown}
      onMouseUp={() => window.focusActiveTerm()}
      onDoubleClick={handleMaximizeClick}
      ref={ref}
    >
      {!isMac && (
        <div
          className={`${styles.headerWindowHeader} ${props.tabs.length > 1 ? styles.headerWindowHeaderWithBorder : ''}`}
          style={{borderColor}}
        >
          {hambMenu && (
            <button
              type="button"
              className={`${styles.headerShape} ${left ? styles.headerHamburgerMenuRight : styles.headerHamburgerMenuLeft}`}
              onClick={handleHamburgerMenuClick}
              aria-label="Open menu"
            >
              <svg className={styles.headerShape}>
                <use xlinkHref="./renderer/assets/icons.svg#hamburger-menu" />
              </svg>
            </button>
          )}
          <span className={styles.headerAppTitle}>{title}</span>
          {winCtrls && (
            <div className={`${styles.headerWindowControls} ${left ? styles.headerWindowControlsLeft : ''}`}>
              <button
                type="button"
                className={`${styles.headerShape} ${left ? styles.headerMinimizeWindowLeft : ''}`}
                onClick={handleMinimizeClick}
                aria-label="Minimise window"
              >
                <svg className={styles.headerShape}>
                  <use xlinkHref="./renderer/assets/icons.svg#minimize-window" />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.headerShape} ${left ? styles.headerMaximizeWindowLeft : ''}`}
                onClick={handleMaximizeClick}
                aria-label={props.maximized ? 'Restore window' : 'Maximise window'}
              >
                <svg className={styles.headerShape}>
                  <use xlinkHref={maxButtonHref} />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.headerShape} ${styles.headerCloseWindow} ${left ? styles.headerCloseWindowLeft : ''}`}
                onClick={handleCloseClick}
                aria-label="Close window"
              >
                <svg className={styles.headerShape}>
                  <use xlinkHref="./renderer/assets/icons.svg#close-window" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
      {props.customChildrenBefore}
      <Tabs
        {...getTabsProps(props, {
          tabs: props.tabs,
          borderColor: props.borderColor,
          backgroundColor: props.backgroundColor,
          onClose: props.onCloseTab,
          onChange: onChangeIntent,
          fullScreen: props.fullScreen,
          defaultProfile: props.defaultProfile,
          profiles: props.profiles.asMutable({deep: true}),
          openNewTab: props.openNewTab
        })}
      />
      {props.customChildren}
    </header>
  );
});

Header.displayName = 'Header';

export default Header;
