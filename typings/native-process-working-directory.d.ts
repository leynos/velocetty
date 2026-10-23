/**
 * @file Types for the vendored `native-process-working-directory` package.
 *
 * The package ships `index.js` plus a TypeScript `index.ts` and points
 * `types` at the latter. Without a declaration the typecheck program resolves
 * that vendored source and compiles it as part of this repository, so a
 * third-party file we do not maintain decides whether our gate passes. Mapping
 * the specifier here keeps the package's shape known and its source out of the
 * program.
 */
declare module 'native-process-working-directory' {
  export function getWorkingDirectoryFromPID(pid: number): string | null;
  export function getWorkingDirectoryFromHandle(handle: number): string | null;
}
