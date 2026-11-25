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
export type KeyLike = {readonly key: string; readonly preventDefault: () => void};

/**
 * Enter commits and Escape reverts a text-like control.
 *
 * @param props - The control's props.
 * @returns The keydown handler.
 */
export const keyHandlerFor =
  (props: FieldControlProps) =>
  (event: KeyLike): void => {
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
