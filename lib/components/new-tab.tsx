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
  const ref = useRef(null);

  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen);
  };

  useClickAway(ref, () => {
    setDropdownOpen(false);
  });

  const tabVars: React.CSSProperties & CSSVars = {
    '--new-tab-border': borderColor,
    '--new-tab-bg': backgroundColor
  };

  return (
    <div ref={ref} style={tabVars}>
      <button
        type="button"
        title="New Tab"
        aria-label="New Tab"
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        className={`${styles.newTab} ${isMac ? styles.newTabMac : ''} ${tabsVisible ? styles.tabsVisible : styles.tabsHidden}`}
        onClick={toggleDropdown}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <VscChevronDown style={{verticalAlign: 'middle'}} />
      </button>

      {dropdownOpen && (
        <div key="dropdown" className={styles.profileDropdown} role="menu">
          {profiles.map((profile) => (
            <button
              key={profile.name}
              type="button"
              role="menuitem"
              onClick={() => {
                openNewTab(profile.name);
                setDropdownOpen(false);
              }}
              className={`${styles.profileDropdownItem} ${
                profile.name === defaultProfile && profiles.length > 1 ? styles.profileDropdownItemDefault : ''
              }`}
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
