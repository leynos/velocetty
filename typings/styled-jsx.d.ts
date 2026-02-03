/**
 * Ensure styled-jsx attributes remain recognised with updated React types.
 */
/// <reference types="react" />

declare namespace React {
  interface HTMLAttributes<T> {
    jsx?: boolean | string | undefined;
    global?: boolean | string | undefined;
  }
}
