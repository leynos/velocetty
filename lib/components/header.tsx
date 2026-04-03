/** @file Renders the header UI with window controls, hamburger menu, and Tabs composition. */
import type React from 'react';
import {forwardRef, useState} from 'react';

import type {HeaderProps} from '../../typings/hyper';
import {decorate, getTabsProps} from '../utils/plugins';

import {orderWindowControlButtons, stopDoubleClickPropagation} from './header-controls';
import Tabs_ from './tabs';
import * as styles from './header.module.css';

const Tabs = decorate(Tabs_, 'Tabs');

type WindowControlButton = {
  key: string;
  ariaLabel: string;
  href: string;
  onClick: () => void;
  className: string;
};

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
  const windowControlButtons = [
    {
      key: 'minimize',
      ariaLabel: props.minimizeWindowAria,
      href: './renderer/assets/icons.svg#minimize-window',
      onClick: handleMinimizeClick,
      className: styles.headerShapeButton
    },
    {
      key: 'maximize',
      ariaLabel: props.maximized ? props.restoreWindowAria : props.maximizeWindowAria,
      href: maxButtonHref,
      onClick: handleMaximizeClick,
      className: styles.headerShapeButton
    },
    {
      key: 'close',
      ariaLabel: props.closeWindowAria,
      href: './renderer/assets/icons.svg#close-window',
      onClick: handleCloseClick,
      className: `${styles.headerShapeButton} ${styles.headerCloseWindow}`
    }
  ] satisfies [WindowControlButton, WindowControlButton, WindowControlButton];
  const orderedWindowControlButtons = orderWindowControlButtons(windowControlButtons, left);

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
              className={`${styles.headerShapeButton} ${left ? styles.headerHamburgerMenuRight : styles.headerHamburgerMenuLeft}`}
              onClick={handleHamburgerMenuClick}
              onDoubleClick={stopDoubleClickPropagation}
              aria-label={props.openMenuAria}
            >
              <svg className={styles.headerShape}>
                <use xlinkHref="./renderer/assets/icons.svg#hamburger-menu" />
              </svg>
            </button>
          )}
          <span className={styles.headerAppTitle}>{title}</span>
          {winCtrls && (
            <div className={`${styles.headerWindowControls} ${left ? styles.headerWindowControlsLeft : ''}`}>
              {orderedWindowControlButtons.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  className={button.className}
                  onClick={button.onClick}
                  onDoubleClick={stopDoubleClickPropagation}
                  aria-label={button.ariaLabel}
                >
                  <svg className={styles.headerShape}>
                    <use xlinkHref={button.href} />
                  </svg>
                </button>
              ))}
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
