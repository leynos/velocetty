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
  const safeId = props.id.replaceAll(/[^a-zA-Z0-9_-]/gu, '-');
  const controlId = `${safeId}-control`;
  const descriptionId = `${safeId}-description`;
  const errorsId = `${safeId}-errors`;
  const disabledId = `${safeId}-disabled`;
  const describedBy = [
    props.description === undefined ? null : descriptionId,
    props.isDisabled ? disabledId : null,
    props.errors.length > 0 ? errorsId : null
  ]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  const reset = (): void => {
    props.onReset();
    document.querySelector<HTMLElement>(`#${controlId}`)?.focus();
  };

  return (
    <div className={styles.row} data-phase={props.phase}>
      <div className={styles.labelBlock}>
        <label className={styles.label} htmlFor={controlId}>
          {props.label}
        </label>
        {props.description !== undefined && (
          <p className={styles.description} id={descriptionId}>
            {props.description}
          </p>
        )}
        {props.isProfileOverridden && (
          <p className={styles.note}>
            The default profile overrides this setting, so a base change may have no visible effect.
          </p>
        )}
      </div>
      <div className={styles.controlBlock}>
        {renderControl(props, {
          controlId,
          label: props.label,
          draft: props.draft,
          isDisabled: props.isDisabled,
          hasErrors: props.errors.length > 0,
          describedBy,
          onChange: props.onChange,
          onCommit: props.onCommit,
          onRevert: props.onRevert
        })}
        {props.isDisabled && props.disabledReason !== undefined && (
          <p className={styles.note} id={disabledId}>
            {props.disabledReason}
          </p>
        )}
        {props.errors.length > 0 && (
          <p className={styles.error} id={errorsId}>
            {props.errors.join(' ')}
          </p>
        )}
        <div className={styles.actions}>
          {props.isModified && (
            <button
              type="button"
              className={styles.reset}
              aria-label={`Reset ${props.label} to default`}
              onClick={reset}
            >
              Reset
            </button>
          )}
          <InlineRestartWarning
            classification={props.requiresRestart ? 'restart' : 'live'}
            show={props.requiresRestart && props.isModified}
            message="This change takes effect after restarting."
          />
        </div>
      </div>
    </div>
  );
};
