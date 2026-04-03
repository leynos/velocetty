/**
 * @file New tab button and profile dropdown component used by terminal tabs.
 *
 * Purpose:
 * - Renders the profile-selection trigger button and a dropdown menu bound to
 *   `tab.visible` styling and dynamic theme variables.
 * - Encapsulates keyboard and click/focus behaviours so profile switching is
 *   accessible and does not depend on page-level event handlers.
 *
 * Required invariants:
 * - Trigger button must keep `aria-label="New Tab"`, `aria-haspopup="menu"`,
 *   and `aria-expanded` in sync with `dropdownOpen`.
 * - Dropdown wrapper must remain `role="menu"` and each profile option must keep
 *   `role="menuitem"` for assistive navigation and expected keyboard semantics.
 * - Focus leaving the component (`onBlur` when `relatedTarget` is external) must
 *   close the dropdown; `Escape` closes only while the dropdown is open.
 * - Required CSS modules for theme and geometry: `styles.newTab`,
 *   `styles.newTabMac`, `styles.tabsVisible`, `styles.tabsHidden`,
 *   `styles.profileDropdown`, `styles.profileDropdownItem`,
 *   `styles.profileDropdownItemDefault`.
 * - Required CSS custom properties on the wrapper: `--new-tab-border`,
 *   `--new-tab-bg`.
 *
 * Related modules:
 * - `lib/components/new-tab.module.css`
 * - `test/unit/new-tab.test.tsx`
 */

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
 * Returns `true` when `target` is a DOM node that lies within `container`.
 * Used to decide whether a blur event should close the dropdown.
 */
function isFocusWithinDropdown(target: EventTarget | null, container: Node | null): boolean {
  return target !== null && 'nodeType' in target && (container?.contains(target as Node) ?? false);
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
    if (!dropdownOpen) {
      return;
    }

    event.preventDefault();
    closeDropdown();
  };

  const handleDropdownBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (isFocusWithinDropdown(event.relatedTarget, ref.current)) {
      return;
    }
    closeDropdown();
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
