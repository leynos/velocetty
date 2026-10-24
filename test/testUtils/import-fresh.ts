/**
 * @file Imports a module that a test must observe from its first evaluation.
 *
 * Bun caches a module by its specifier, and every test file shares one module
 * registry in the `bun test` process. A suite that installs `mock.module(...)`
 * before importing therefore has to import under a specifier no earlier suite
 * has used, or it receives the already-evaluated module and the mock never
 * applies. A query string gives each such import its own cache entry.
 *
 * TypeScript cannot resolve a specifier that carries a query, so the query is
 * appended at run time and the caller names the expected shape with the type
 * argument. That argument is a claim about this repository's own module, not
 * about untrusted input; the compiler cannot verify it, so keep it in step with
 * the imported module's exports.
 *
 * @example
 * ```ts
 * const {transport} = await importFresh<typeof import('../../lib/transport/electron-ipc-transport')>(
 *   '../../lib/transport/electron-ipc-transport',
 *   'transport_unit'
 * );
 * ```
 */

/**
 * Imports `specifier` under a query-suffixed cache key.
 *
 * @param specifier - Repository-relative module path, without a query.
 * @param cacheKey - Query value that distinguishes this import from earlier ones.
 * @returns The module's exports, typed by the caller.
 */
export const importFresh = async <T>(specifier: string, cacheKey: string): Promise<T> =>
  await import(`${specifier}?${cacheKey}`);
