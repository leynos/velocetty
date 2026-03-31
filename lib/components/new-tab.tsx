/** @file New tab button component with profile selection dropdown. */

import {useRef, useState} from 'react';

import {VscChevronDown} from '@react-icons/all-files/vsc/VscChevronDown';
import useClickAway from 'react-use/lib/useClickAway';

import type {configOptions} from '@shared/types/config';
import styles from './new-tab.module.css';

interface Props {
  defaultProfile: string;
  profiles: configOptions['profiles'];
  openNewTab: (name: string) => void;
  backgroundColor: string;
  borderColor: string;
  tabsVisible: boolean;
}
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

  const tabVars: React.CSSProperties = {
    '--new-tab-border': borderColor,
    '--new-tab-bg': backgroundColor
  };

  return (
    <button
      type="button"
      ref={ref}
      title="New Tab"
      className={`${styles.newTab} ${isMac ? styles.newTabMac : ''} ${tabsVisible ? styles.tabsVisible : styles.tabsHidden}`}
      onClick={toggleDropdown}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => setDropdownOpen(false)}
      style={tabVars}
    >
      <VscChevronDown style={{verticalAlign: 'middle'}} />

      {dropdownOpen && (
        <ul key="dropdown" className={styles.profileDropdown}>
          {profiles.map((profile) => (
            <li
              key={profile.name}
              onClick={() => {
                openNewTab(profile.name);
                setDropdownOpen(false);
              }}
              className={`${styles.profileDropdownItem} ${
                profile.name === defaultProfile && profiles.length > 1 ? styles.profileDropdownItemDefault : ''
              }`}
            >
              {profile.name}
            </li>
          ))}
        </ul>
      )}
    </button>
  );
};

export default DropdownButton;
