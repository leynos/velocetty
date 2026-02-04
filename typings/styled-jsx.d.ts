/**
 * Ensure styled-jsx attributes remain recognised with updated React types.
 */
/// <reference types="react" />

declare namespace JSX {
  interface IntrinsicElements {
    style: React.DetailedHTMLProps<React.StyleHTMLAttributes<HTMLStyleElement>, HTMLStyleElement> & {
      jsx?: boolean | string | undefined;
      global?: boolean | string | undefined;
    };
  }
}
