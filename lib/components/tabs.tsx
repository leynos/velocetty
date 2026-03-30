/** @file Renders the tabs strip and new tab controls. */
import type React from 'react';
import {forwardRef, useEffect, useReducer} from 'react';

import type {TabsProps} from '../../typings/hyper';
import {decorate, getTabProps, subscribeTabDecorationUpdates} from '../utils/plugins';

import DropdownButton from './new-tab';
import Tab_ from './tab';
import styles from './tabs.module.css';

const Tab = decorate(Tab_, 'Tab');
const isMac = /Mac/.test(navigator.userAgent);

const Tabs = forwardRef(function Tabs(props: TabsProps, ref: React.ForwardedRef<HTMLElement>) {
  const [, forceDecorationRender] = useReducer((version: number) => version + 1, 0);
  const {tabs = [], borderColor, onChange, onClose, fullScreen} = props;

  const hide = !isMac && tabs.length === 1;

  useEffect(() => {
    return subscribeTabDecorationUpdates(() => {
      forceDecorationRender();
    });
  }, []);

  return (
    <nav
      className={`${styles.tabsNav} ${hide ? styles.tabsHiddenNav : ''} ${isMac ? styles.tabsNavMac : styles.tabsNavNonMac}`}
      ref={ref}
    >
      {props.customChildrenBefore}
      {tabs.length === 1 && isMac ? <div className={styles.tabsTitle}>{tabs[0].title}</div> : null}
      {tabs.length > 1 ? (
        <>
          <ul
            key="list"
            className={`${styles.tabsList} ${isMac ? styles.tabsListMacOffset : ''} ${fullScreen && isMac ? styles.tabsFullScreen : ''}`}
          >
            {tabs.map((tab, i) => {
              const {uid, title, isActive, hasActivity} = tab;
              const tabProps = getTabProps({...tab, tabIndex: i}, props, {
                text: title === '' ? 'Shell' : title,
                isFirst: i === 0,
                isLast: tabs.length - 1 === i,
                borderColor,
                isActive,
                hasActivity,
                onSelect: onChange.bind(null, uid),
                onClose: onClose.bind(null, uid)
              });
              return <Tab key={`tab-${uid}`} {...tabProps} />;
            })}
          </ul>
          {isMac && (
            <div
              key="shim"
              style={{borderColor}}
              className={`${styles.tabsBorderShim} ${fullScreen ? styles.tabsBorderShimUndo : ''}`}
            />
          )}
        </>
      ) : null}
      <DropdownButton {...props} tabsVisible={tabs.length > 1} />
      {props.customChildren}
    </nav>
  );
});

Tabs.displayName = 'Tabs';

export default Tabs;
