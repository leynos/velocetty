/** @file Select control for enumerated settings. */
import type {ComponentProps, ReactElement} from 'react';

import * as styles from './controls.module.css';

import type {ControlDescriptor} from '@shared/settings/panel-model';

import type {FieldControlProps} from './types';

type SelectControlProps = FieldControlProps & {readonly control: Extract<ControlDescriptor, {kind: 'select'}>};

/**
 * Renders a select for an enumerated setting.
 *
 * @param props - The shared props plus the select's options.
 * @returns The select element.
 */
export const SelectField = (props: SelectControlProps): ReactElement<ComponentProps<'select'>> => (
  <select
    id={props.controlId}
    className={styles.control}
    value={props.draft}
    disabled={props.isDisabled}
    aria-invalid={props.hasErrors}
    aria-describedby={props.describedBy}
    onChange={(event) => {
      props.onChange(event.target.value);
      props.onCommit();
    }}
  >
    {props.control.options.map((option) => (
      <option key={option} value={option}>
        {option === '' ? '(none)' : option}
      </option>
    ))}
  </select>
);
