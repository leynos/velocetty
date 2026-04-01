/** @file Renders a single tab with close and select handlers. */
import type React from 'react';
import {forwardRef} from 'react';

import clsx from 'clsx';

import type {TabProps} from '../../typings/hyper';
import styles from './tab.module.css';

/**
 * Computes the class name for the tab list item.
 *
 * @param isFirst - Whether this is the first tab in the list.
 * @param isActive - Whether this tab is currently active.
 * @param hasActivity - Whether this tab has unseen activity.
 * @returns The computed class name string.
 */
const tabListItemClass = (isFirst: boolean, isActive: boolean, hasActivity: boolean): string =>
  clsx(
    styles.tabTab,
    isFirst && styles.tabFirst,
    isActive && styles.tabActive,
    isFirst && isActive && styles.tabFirstActive,
    hasActivity && styles.tabHasActivity
  );

/**
 * Computes the class name for the tab text span.
 *
 * @returns The computed class name string.
 */
const tabTextClass = (): string => styles.tabText;

/**
 * Handles click events on the tab, invoking the select handler for left clicks
 * on inactive tabs.
 *
 * @param event - The React mouse event.
 * @param isActive - Whether the tab is currently active.
 * @param onSelect - Callback to invoke when the tab should be selected.
 */
const onTabClick = (event: React.MouseEvent, isActive: boolean, onSelect: () => void): void => {
  if (event.button === 0 && !isActive) {
    onSelect();
  }
};

/**
 * Handles mouse up events on the tab, invoking the close handler for middle clicks.
 *
 * @param event - The React mouse event.
 * @param onClose - Callback to invoke when the tab should be closed.
 */
const onTabMouseUp = (event: React.MouseEvent, onClose: () => void): void => {
  if (event.button === 1) {
    onClose();
  }
};

const Tab = forwardRef(function Tab(props: TabProps, ref: React.ForwardedRef<HTMLLIElement>) {
  const {isActive, isFirst, borderColor, hasActivity} = props;

  const handleClick = (event: React.MouseEvent) => onTabClick(event, isActive, props.onSelect);
  const handleMouseUp = (event: React.MouseEvent) => onTabMouseUp(event, props.onClose);

  return (
    <li
      onClick={props.onClick}
      style={{borderColor}}
      className={tabListItemClass(isFirst, isActive, hasActivity)}
      ref={ref}
    >
      {props.customChildrenBefore}
      <span className={tabTextClass()} onClick={handleClick} onMouseUp={handleMouseUp}>
        <span title={props.text} className={styles.tabTextInner}>
          {props.text}
        </span>
      </span>
      <button
        type="button"
        className={styles.tabIcon}
        aria-label={`Close ${props.text}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onClose();
        }}
      >
        <svg className={styles.tabShape}>
          <use xlinkHref="./renderer/assets/icons.svg#close-tab" />
        </svg>
      </button>
      {props.customChildren}
    </li>
  );
});

Tab.displayName = 'Tab';

export default Tab;
