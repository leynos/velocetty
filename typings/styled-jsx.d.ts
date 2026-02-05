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
import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      style: React.DetailedHTMLProps<React.StyleHTMLAttributes<HTMLStyleElement>, HTMLStyleElement> & {
        jsx?: boolean | string | undefined;
        global?: boolean | string | undefined;
      };
    }
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      style: React.DetailedHTMLProps<React.StyleHTMLAttributes<HTMLStyleElement>, HTMLStyleElement> & {
        jsx?: boolean | string | undefined;
        global?: boolean | string | undefined;
      };
    }
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      style: React.DetailedHTMLProps<React.StyleHTMLAttributes<HTMLStyleElement>, HTMLStyleElement> & {
        jsx?: boolean | string | undefined;
        global?: boolean | string | undefined;
      };
    }
  }
}

// biome-ignore lint/complexity/noUselessEmptyExport: keep explicit module marker for declaration consistency.
export {};
