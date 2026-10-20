/** @file Renders the tabs strip and new tab controls. */
import type React from 'react';
import {forwardRef, useCallback, useEffect, useReducer} from 'react';

import type {TabProps, TabsProps} from '../../typings/hyper';
import type {getTabProps} from '../utils/plugins';
import type DropdownButton from './new-tab';
import Tab_ from './tab';
import * as styles from './tabs.module.css';

const isMac = /Mac/.test(navigator.userAgent);

type TabItemProps = {
  tab: TabsProps['tabs'][number];
  index: number;
  totalTabs: number;
  borderColor: string;
  onChange: TabsProps['onChange'];
  onClose: TabsProps['onClose'];
  parentProps: TabsProps;
};

export type TabsComponentDependencies = {
  decorate: (component: typeof Tab_, name: string) => React.ElementType<TabProps>;
  getTabProps: typeof getTabProps;
  subscribeTabDecorationUpdates: (listener: () => void) => () => void;
  DropdownButton: typeof DropdownButton;
};

/** Builds the tabs strip with its renderer plug-in dependencies. */
export const createTabsComponent = ({
  decorate: decorateComponent,
  getTabProps: getPropsForTab,
  subscribeTabDecorationUpdates: subscribeToDecorationUpdates,
  DropdownButton: NewTabButton
}: TabsComponentDependencies) => {
  const Tab = decorateComponent(Tab_, 'Tab');

  const TabItem = ({tab, index, totalTabs, borderColor, onChange, onClose, parentProps}: TabItemProps) => {
    const {uid, title, isActive, hasActivity} = tab;

    const handleSelect = useCallback(() => {
      onChange(uid);
    }, [onChange, uid]);

    const handleClose = useCallback(() => {
      onClose(uid);
    }, [onClose, uid]);

    const tabProps = getPropsForTab({...tab, tabIndex: index}, parentProps, {
      text: title === '' ? 'Shell' : title,
      isFirst: index === 0,
      isLast: totalTabs - 1 === index,
      borderColor,
      isActive,
      hasActivity,
      onSelect: handleSelect,
      onClose: handleClose
    });

    return <Tab {...tabProps} />;
  };

  return forwardRef(function Tabs(props: TabsProps, ref: React.ForwardedRef<HTMLElement>) {
    const [, forceDecorationRender] = useReducer((version: number) => version + 1, 0);
    const {tabs = [], borderColor, onChange, onClose, fullScreen} = props;

    const hide = !isMac && tabs.length === 1;

    useEffect(() => {
      return subscribeToDecorationUpdates(() => {
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
              {tabs.map((tab, i) => (
                <TabItem
                  key={tab.uid}
                  borderColor={borderColor}
                  index={i}
                  onChange={onChange}
                  onClose={onClose}
                  parentProps={props}
                  tab={tab}
                  totalTabs={tabs.length}
                />
              ))}
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
        <NewTabButton {...props} tabsVisible={tabs.length > 1} />
        {props.customChildren}
      </nav>
    );
  });
};
