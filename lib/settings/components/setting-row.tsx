/**
 * @file One editable setting: label, control, inline errors, and reset.
 *
 * The row owns only presentation. Drafts, phases, and writes belong to the
 * field store, which is why every handler arrives as a prop.
 *
 * Accessibility: the control is labelled by the row's `<label>`, described by
 * the description, the disabled reason, and the error list, and marked
 * `aria-invalid` by the control itself. Reset is labelled with the setting's
 * name and returns focus to the control it reset.
 */

import type {ReactElement} from 'react';

import {InlineRestartWarning} from '../../components/restart-required-indicator';

import {ColourField} from './controls/colour-field';
import {NumberField} from './controls/number-field';
import {SelectField} from './controls/select-field';
import {TextField} from './controls/text-field';
import {ToggleField} from './controls/toggle-field';

import * as styles from './setting-row.module.css';

import type {FieldControlProps} from './controls/types';
import type {ControlDescriptor} from '@shared/settings/panel-model';
import type {FieldPhase} from '@shared/settings/field-state';

/** Everything one editable row needs. */
export type SettingRowProps = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly control: ControlDescriptor;
  readonly draft: string;
  readonly phase: FieldPhase;
  readonly errors: readonly string[];
  readonly isModified: boolean;
  readonly isDisabled: boolean;
  readonly disabledReason?: string;
  readonly isProfileOverridden: boolean;
  readonly requiresRestart: boolean;
  readonly onChange: (draft: string) => void;
  readonly onCommit: () => void;
  readonly onRevert: () => void;
  readonly onReset: () => void;
};

/** The element ids that wire the row's label and notes to its control. */
type RowIds = {
  readonly control: string;
  readonly description: string;
  readonly errors: string;
  readonly disabled: string;
};

const idsFor = (id: string): RowIds => {
  const safeId = id.replaceAll(/[^a-zA-Z0-9_-]/gu, '-');
  return {
    control: `${safeId}-control`,
    description: `${safeId}-description`,
    errors: `${safeId}-errors`,
    disabled: `${safeId}-disabled`
  };
};

const describedByFor = (props: SettingRowProps, ids: RowIds): string => {
  const description = props.description === undefined ? null : ids.description;
  const disabled = props.isDisabled ? ids.disabled : null;
  const errors = props.errors.length > 0 ? ids.errors : null;
  return [description, disabled, errors].filter((id): id is string => id !== null).join(' ');
};

const renderControl = (props: SettingRowProps, controlProps: FieldControlProps): ReactElement => {
  switch (props.control.kind) {
    case 'toggle': {
      return <ToggleField {...controlProps} />;
    }
    case 'select': {
      return <SelectField {...controlProps} control={props.control} />;
    }
    case 'number': {
      return <NumberField {...controlProps} control={props.control} />;
    }
    case 'colour': {
      return <ColourField {...controlProps} />;
    }
    case 'text': {
      return <TextField {...controlProps} />;
    }
  }
};

type RowLabelProps = {
  readonly label: string;
  readonly description?: string;
  readonly isProfileOverridden: boolean;
  readonly controlId: string;
  readonly descriptionId: string;
};

const RowLabel = (props: RowLabelProps): ReactElement => (
  <div className={styles.labelBlock}>
    <label className={styles.label} htmlFor={props.controlId}>
      {props.label}
    </label>
    {props.description !== undefined && (
      <p className={styles.description} id={props.descriptionId}>
        {props.description}
      </p>
    )}
    {props.isProfileOverridden && (
      <p className={styles.note}>
        The default profile overrides this setting, so a base change may have no visible effect.
      </p>
    )}
  </div>
);

type RowNotesProps = {
  readonly isDisabled: boolean;
  readonly disabledReason?: string;
  readonly errors: readonly string[];
  readonly disabledId: string;
  readonly errorsId: string;
};

const RowNotes = (props: RowNotesProps): ReactElement => (
  <>
    {props.isDisabled && props.disabledReason !== undefined && (
      <p className={styles.note} id={props.disabledId}>
        {props.disabledReason}
      </p>
    )}
    {props.errors.length > 0 && (
      <p className={styles.error} id={props.errorsId} role="alert">
        {props.errors.join(' ')}
      </p>
    )}
  </>
);

type RowActionsProps = {
  readonly label: string;
  readonly controlId: string;
  readonly isDisabled: boolean;
  readonly isModified: boolean;
  readonly requiresRestart: boolean;
  readonly onReset: () => void;
};

const RowActions = (props: RowActionsProps): ReactElement => {
  const reset = (): void => {
    props.onReset();
    document.querySelector<HTMLElement>(`#${props.controlId}`)?.focus();
  };
  return (
    <div className={styles.actions}>
      {props.isModified && (
        <button
          type="button"
          className={styles.reset}
          aria-label={`Reset ${props.label} to default`}
          disabled={props.isDisabled}
          onClick={reset}
        >
          Reset
        </button>
      )}
      <InlineRestartWarning
        classification={props.requiresRestart ? 'restart' : 'live'}
        show={props.requiresRestart}
        message="This setting takes effect after restarting."
      />
    </div>
  );
};

type RowControlProps = {
  readonly row: SettingRowProps;
  readonly ids: RowIds;
  readonly describedBy: string;
};

const RowControl = (props: RowControlProps): ReactElement => {
  const {row} = props;
  return (
    <div className={styles.controlBlock}>
      {renderControl(row, {
        controlId: props.ids.control,
        label: row.label,
        draft: row.draft,
        isDisabled: row.isDisabled,
        hasErrors: row.errors.length > 0,
        describedBy: props.describedBy,
        onChange: row.onChange,
        onCommit: row.onCommit,
        onRevert: row.onRevert
      })}
      <RowNotes
        isDisabled={row.isDisabled}
        disabledReason={row.disabledReason}
        errors={row.errors}
        disabledId={props.ids.disabled}
        errorsId={props.ids.errors}
      />
      <RowActions
        label={row.label}
        controlId={props.ids.control}
        isDisabled={row.isDisabled}
        isModified={row.isModified}
        requiresRestart={row.requiresRestart}
        onReset={row.onReset}
      />
    </div>
  );
};

/**
 * Renders one editable setting row.
 *
 * @param props - The field's state and handlers.
 * @returns The row.
 *
 * @example
 * <SettingRow {...row} />
 */
export const SettingRow = (props: SettingRowProps): ReactElement => {
  const ids = idsFor(props.id);
  return (
    <div className={styles.row} data-phase={props.phase}>
      <RowLabel
        label={props.label}
        description={props.description}
        isProfileOverridden={props.isProfileOverridden}
        controlId={ids.control}
        descriptionId={ids.description}
      />
      <RowControl row={props} ids={ids} describedBy={describedByFor(props, ids)} />
    </div>
  );
};
