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
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement && 'nodeType' in nextFocusedElement && ref.current?.contains(nextFocusedElement as Node)) {
      return;
    }

    closeDropdown();
  };

  const tabVars: React.CSSProperties & CSSVars = {
    '--new-tab-border': borderColor,
    '--new-tab-bg': backgroundColor,
    position: 'relative'
  };
  const buttonClassName = [
    styles.newTab,
    isMac ? styles.newTabMac : null,
    tabsVisible ? styles.tabsVisible : styles.tabsHidden
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} style={tabVars}>
      <button
        type="button"
        title="New Tab"
        aria-label="New Tab"
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        className={buttonClassName}
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
              className={[
                styles.profileDropdownItem,
                profile.name === defaultProfile && profiles.length > 1 ? styles.profileDropdownItemDefault : null
              ]
                .filter(Boolean)
                .join(' ')}
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
