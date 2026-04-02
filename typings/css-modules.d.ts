/** @file Type declarations for CSS Modules, providing scoped class name mappings. */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export = classes;
}
