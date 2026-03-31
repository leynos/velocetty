/** @file Renders a single tab with close and select handlers. */
import type React from 'react';
import {forwardRef} from 'react';

import clsx from 'clsx';

import type {TabProps} from '../../typings/hyper';
import styles from './tab.module.css';

const Tab = forwardRef(function Tab(props: TabProps, ref: React.ForwardedRef<HTMLLIElement>) {
  const handleClick = (event: React.MouseEvent) => {
    const isLeftClick = event.nativeEvent.which === 1;

    if (isLeftClick && !props.isActive) {
      props.onSelect();
    }
  };

  const handleMouseUp = (event: React.MouseEvent) => {
    const isMiddleClick = event.nativeEvent.which === 2;

    if (isMiddleClick) {
      props.onClose();
    }
  };

  const {isActive, isFirst, isLast, borderColor, hasActivity} = props;

  return (
    <li
      onClick={props.onClick}
      style={{borderColor}}
      className={clsx(
        styles.tabTab,
        isFirst && styles.tabFirst,
        isActive && styles.tabActive,
        isFirst && isActive && styles.tabFirstActive,
        hasActivity && styles.tabHasActivity
      )}
      ref={ref}
    >
      {props.customChildrenBefore}
      <span
        className={clsx(styles.tabText, isLast && styles.tabTextLast, isActive && styles.tabTextActive)}
        onClick={handleClick}
        onMouseUp={handleMouseUp}
      >
        <span title={props.text} className={styles.tabTextInner}>
          {props.text}
        </span>
      </span>
      <i className={styles.tabIcon} onClick={props.onClose}>
        <svg className={styles.tabShape}>
          <use xlinkHref="./renderer/assets/icons.svg#close-tab" />
        </svg>
      </i>
      {props.customChildren}
    </li>
  );
});

Tab.displayName = 'Tab';

export default Tab;
