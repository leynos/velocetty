/** @file Colour control: a text field with a swatch preview. */
import type {ComponentProps, ReactElement} from 'react';

import * as styles from './controls.module.css';

import {isColourValue} from '@shared/settings/coerce';

import {keyHandlerFor, type FieldControlProps} from './types';

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Renders a colour input. The swatch previews any valid colour and is hidden
 * from assistive technology; the text field carries the value.
 *
 * @param props - The shared control props.
 * @returns The colour input with its swatch.
 */
export const ColourField = (props: FieldControlProps): ReactElement<ComponentProps<'input'>> => (
  <span className={styles.colour}>
    <span
      className={styles.swatch}
      aria-hidden="true"
      style={{backgroundColor: isColourValue(props.draft) ? props.draft : 'transparent'}}
    />
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
      data-hex={HEX_COLOUR.test(props.draft) ? 'true' : 'false'}
    />
  </span>
);
