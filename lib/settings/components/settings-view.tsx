/**
 * @file The settings tab's view.
 *
 * Pure: it renders the props it is given and reports intent through callbacks.
 * Translations arrive as a `strings` prop from the container's hook, so the
 * component itself has no state beyond the search box's focus.
 *
 * Accessibility: the search box is a labelled `searchbox` focused when the
 * surface becomes active; the category list marks the current entry with
 * `aria-current`; one polite live region announces result counts and status
 * messages; the empty state offers a single action that clears both filters.
 */

import {useEffect, useRef} from 'react';
import type {ReactElement} from 'react';

import * as styles from './settings-view.module.css';

import type {SettingsCategorySelection} from '@shared/constants/settings-tab';
import type {SettingCategoryId} from '@shared/settings/panel-model';

/** One row in the results region. */
export type SettingsRow = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly value: string;
  readonly isModified: boolean;
};

/** One group of rows under a category heading. */
export type SettingsSection = {
  readonly category: SettingCategoryId;
  readonly label: string;
  readonly rows: readonly SettingsRow[];
};

/** One entry in the category navigation. */
export type SettingsCategory = {
  readonly id: SettingsCategorySelection;
  readonly label: string;
  readonly count: number;
};

/** The fixed text the view needs. */
export type SettingsViewStrings = {
  readonly title: string;
  readonly search: string;
  readonly searchPlaceholder: string;
  readonly categories: string;
  readonly results: string;
  readonly noResults: string;
  readonly clearFilters: string;
  readonly openConfigFile: string;
  readonly modified: string;
};

/** Everything the view renders. */
export type SettingsViewProps = {
  readonly strings: SettingsViewStrings;
  readonly sections: readonly SettingsSection[];
  readonly categories: readonly SettingsCategory[];
  readonly query: string;
  readonly selectedCategory: SettingsCategorySelection;
  readonly resultCount: number;
  readonly statusMessage: string;
  readonly banner: string | null;
  readonly isActive: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onCategorySelect: (category: SettingsCategorySelection) => void;
  readonly onClearFilters: () => void;
  readonly onOpenConfigFile: () => void;
};

const categoryIsCurrent = (category: SettingsCategory, selected: SettingsCategorySelection): 'true' | undefined =>
  category.id === selected ? 'true' : undefined;

/**
 * Renders the settings panel.
 *
 * @param props - The model, filters, strings, and callbacks.
 * @returns The settings surface.
 *
 * @example
 * <SettingsView {...props} />
 */
export const SettingsView = (props: SettingsViewProps): ReactElement => {
  const searchRef = useRef<HTMLInputElement>(null);
  const {strings} = props;

  useEffect(() => {
    if (props.isActive) {
      searchRef.current?.focus();
    }
  }, [props.isActive]);

  return (
    <section className={styles.settings} aria-label={strings.title}>
      <header className={styles.header}>
        <h1 className={styles.title}>{strings.title}</h1>
        <button type="button" className={styles.openFile} onClick={props.onOpenConfigFile}>
          {strings.openConfigFile}
        </button>
      </header>

      {props.banner !== null && (
        <p className={styles.banner} role="note">
          {props.banner}
        </p>
      )}

      <div className={styles.searchRow}>
        <input
          ref={searchRef}
          type="search"
          aria-label={strings.search}
          aria-describedby="settings-result-count"
          className={styles.search}
          placeholder={strings.searchPlaceholder}
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
      </div>

      <nav className={styles.categories} aria-label={strings.categories}>
        <ul className={styles.categoryList}>
          {props.categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                className={styles.categoryButton}
                aria-current={categoryIsCurrent(category, props.selectedCategory)}
                onClick={() => props.onCategorySelect(category.id)}
              >
                {category.label}
                <span className={styles.categoryCount}>{category.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <output id="settings-result-count" className={styles.status} aria-live="polite">
        {props.statusMessage}
      </output>

      <section className={styles.results} aria-label={strings.results}>
        {props.resultCount === 0 ? (
          <div className={styles.empty}>
            <p>{strings.noResults}</p>
            <button type="button" onClick={props.onClearFilters}>
              {strings.clearFilters}
            </button>
          </div>
        ) : (
          props.sections.map((section) => (
            <section key={section.category} className={styles.section} aria-label={section.label}>
              <h2 className={styles.sectionTitle}>{section.label}</h2>
              <ul className={styles.rows}>
                {section.rows.map((row) => (
                  <li key={row.id} className={styles.row}>
                    <div className={styles.rowText}>
                      <span className={styles.rowLabel}>{row.label}</span>
                      {row.description !== undefined && (
                        <span className={styles.rowDescription}>{row.description}</span>
                      )}
                    </div>
                    <span className={styles.rowValue}>{row.value}</span>
                    {row.isModified && <span className={styles.modified}>{strings.modified}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </section>
  );
};
