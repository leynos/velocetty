/** @file New tab button component with profile selection dropdown. */

import {useRef, useState} from 'react';

import {VscChevronDown} from '@react-icons/all-files/vsc/VscChevronDown';
import useClickAway from 'react-use/lib/useClickAway';

import type {configOptions} from '@shared/types/config';
import * as styles from './new-tab.module.css';

interface Props {
  defaultProfile: string;
  profiles: configOptions['profiles'];
  openNewTab: (name: string) => void;
  backgroundColor: string;
  borderColor: string;
  tabsVisible: boolean;
}

/** CSS custom property names for theming */
type CSSVars = Record<`--${string}`, string>;

const isMac = /Mac/.test(navigator.userAgent);

/** Returns the CSS class string for the new-tab trigger button. */
function newTabButtonClass(tabsVisible: boolean): string {
  return [styles.newTab, isMac ? styles.newTabMac : null, tabsVisible ? styles.tabsVisible : styles.tabsHidden]
    .filter(Boolean)
    .join(' ');
}

/** Returns the CSS class string for a profile dropdown item. */
function profileItemClass(name: string, defaultProfile: string, profileCount: number): string {
  return [
    styles.profileDropdownItem,
    name === defaultProfile && profileCount > 1 ? styles.profileDropdownItemDefault : null
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Returns `true` when focus is moving to an element outside the given
 * container, indicating the dropdown should be closed.
 */
function isFocusLeavingContainer(event: React.FocusEvent<HTMLElement>, container: HTMLElement | null): boolean {
  const next = event.relatedTarget;
  return !(next && 'nodeType' in next && container?.contains(next as Node));
}

const DropdownButton = ({defaultProfile, profiles, openNewTab, backgroundColor, borderColor, tabsVisible}: Props) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen);
  };

  useClickAway(ref, () => {
    setDropdownOpen(false);
  });

  const closeDropdown = () => {
    setDropdownOpen(false);
  };

  const handleEscapeKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    closeDropdown();
  };

  const handleDropdownBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (isFocusLeavingContainer(event, ref.current)) {
      closeDropdown();
    }
  };

  const tabVars: React.CSSProperties & CSSVars = {
    '--new-tab-border': borderColor,
    '--new-tab-bg': backgroundColor,
    position: 'relative'
  };

  return (
    <div ref={ref} style={tabVars}>
      <button
        type="button"
        title="New Tab"
        aria-label="New Tab"
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        className={newTabButtonClass(tabsVisible)}
        onClick={toggleDropdown}
        onKeyDown={handleEscapeKey}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <VscChevronDown style={{verticalAlign: 'middle'}} />
      </button>

      {dropdownOpen && (
        <div
          key="dropdown"
          className={styles.profileDropdown}
          role="menu"
          onBlur={handleDropdownBlur}
          onKeyDown={handleEscapeKey}
        >
          {profiles.map((profile) => (
            <button
              key={profile.name}
              type="button"
              role="menuitem"
              onClick={() => {
                openNewTab(profile.name);
                closeDropdown();
              }}
              className={profileItemClass(profile.name, defaultProfile, profiles.length)}
            >
              {profile.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DropdownButton;
