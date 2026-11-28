/** @file Text control for free-form string settings. */
import type {ComponentProps, ReactElement} from 'react';

import * as styles from './controls.module.css';

import {keyHandlerFor, type FieldControlProps} from './types';

/**
 * Renders a text input. Enter commits, Escape reverts, and blur commits.
 *
 * @param props - The shared control props.
 * @returns The text input.
 */
export const TextField = (props: FieldControlProps): ReactElement<ComponentProps<'input'>> => (
  <input
    id={props.controlId}
    type="text"
    className={styles.control}
    value={props.draft}
    disabled={props.isDisabled}
    aria-invalid={props.hasErrors}
    aria-describedby={props.describedBy}
    onChange={(event) => props.onChange(event.target.value)}
    onKeyDown={keyHandlerFor(props)}
    onBlur={props.onCommit}
  />
);
