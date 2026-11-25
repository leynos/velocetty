/** @file Number control for bounded numeric settings. */
import type {ComponentProps, ReactElement} from 'react';

import * as styles from './controls.module.css';

import type {ControlDescriptor} from '@shared/settings/panel-model';

import {keyHandlerFor, type FieldControlProps} from './types';

type NumberControlProps = FieldControlProps & {readonly control: Extract<ControlDescriptor, {kind: 'number'}>};

/**
 * Renders a numeric field. The input is textual on purpose: the browser's
 * number input silently discards letters, so a user typing `abc` would see no
 * error at all. The write policy and the local coercion are the validators.
 * Enter commits, Escape reverts, and blur commits, as the scenarios describe.
 *
 * @param props - The shared props plus the numeric bounds.
 * @returns The number input.
 */
export const NumberField = (props: NumberControlProps): ReactElement<ComponentProps<'input'>> => (
  <input
    id={props.controlId}
    type="text"
    className={styles.control}
    inputMode={props.control.isInteger ? 'numeric' : 'decimal'}
    value={props.draft}
    disabled={props.isDisabled}
    aria-invalid={props.hasErrors}
    aria-describedby={props.describedBy}
    onChange={(event) => props.onChange(event.target.value)}
    onKeyDown={keyHandlerFor(props)}
    onBlur={props.onCommit}
  />
);
