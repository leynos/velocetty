/** @file Toggle control for boolean settings. */
import type {ComponentProps, ReactElement} from 'react';

import * as styles from './controls.module.css';

import type {FieldControlProps} from './types';

/**
 * Renders a switch for a boolean setting. A toggle applies immediately, which
 * is why it commits on change rather than on Enter.
 *
 * @param props - The shared control props.
 * @returns The toggle input.
 */
export const ToggleField = (props: FieldControlProps): ReactElement<ComponentProps<'input'>> => (
  <input
    id={props.controlId}
    type="checkbox"
    role="switch"
    aria-checked={props.draft === 'true'}
    className={styles.control}
    checked={props.draft === 'true'}
    disabled={props.isDisabled}
    aria-invalid={props.hasErrors}
    aria-describedby={props.describedBy}
    onChange={(event) => {
      props.onChange(event.target.checked ? 'true' : 'false');
      props.onCommit();
    }}
  />
);
