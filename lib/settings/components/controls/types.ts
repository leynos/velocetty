/** @file Shared props and keyboard handling for the settings field controls. */

/** Props every field control receives. */
export type FieldControlProps = {
  readonly controlId: string;
  readonly label: string;
  readonly draft: string;
  readonly isDisabled: boolean;
  readonly hasErrors: boolean;
  /** Space-separated ids for `aria-describedby`. */
  readonly describedBy: string;
  readonly onChange: (draft: string) => void;
  readonly onCommit: () => void;
  readonly onRevert: () => void;
};

/** The part of a keyboard event the controls read. */
export type KeyLike = {
  readonly key: string;
  readonly preventDefault: () => void;
  /** True while an input method editor (IME) is composing, when the browser reports it. */
  readonly isComposing?: boolean;
  /** The native event behind a React synthetic event, which carries composition state. */
  readonly nativeEvent?: {readonly isComposing?: boolean};
};

/**
 * Reports whether the event is part of an IME composition.
 *
 * React's synthetic keyboard event does not expose `isComposing` directly, but
 * its `nativeEvent` does; a plain DOM event or a test double may carry the flag
 * itself.
 */
const isComposing = (event: KeyLike): boolean => event.isComposing === true || event.nativeEvent?.isComposing === true;

/**
 * Enter commits and Escape reverts a text-like control.
 *
 * A key pressed during an IME composition belongs to the composition, not to
 * the field: Enter accepts the candidate and Escape cancels it. Acting on
 * either would commit or discard a half-typed draft, so the handler returns
 * before touching the draft or the default action.
 *
 * @param props - The control's props.
 * @returns The keydown handler.
 *
 * @example
 * const handler = keyHandlerFor(props);
 * handler(event); // commits on Enter, reverts on Escape, ignores IME keys
 */
export const keyHandlerFor =
  (props: FieldControlProps) =>
  (event: KeyLike): void => {
    if (isComposing(event)) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onCommit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onRevert();
    }
  };
