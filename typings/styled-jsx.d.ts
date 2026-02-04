/**
 * @file Augments the JSX namespace so `styled-jsx` attributes (`jsx`, `global`)
 * remain recognised on `IntrinsicElements.style` during type-checking.
 *
 * Responsibilities:
 * - Extend `JSX.IntrinsicElements.style` with `styled-jsx` attributes so
 *   renderer styles compile without `jsx`/`global` attribute warnings.
 *
 * Usage:
 * - Keep this augmentation aligned with how `styled-jsx` is used in the
 *   renderer.
 *
 * Maintenance:
 * - Update or remove this file if `styled-jsx` usage is replaced or if React's
 *   types begin to include these attributes natively.
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
