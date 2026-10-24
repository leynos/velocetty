/**
 * @file The bundled default configuration, typed as a resolved `configOptions`.
 *
 * `resolveJsonModule` types every JSON string as `string`, so importing
 * `config-default.json` directly loses the literal unions `configOptions`
 * declares (`updateChannel`, `bell`, `cursorShape`, and so on). The bundled
 * default is the one configuration file whose contents are known at build time
 * and checked at load: `app/config/json5-config.ts` validates it against the
 * generated JSON schema before the app uses it, and
 * `test/unit/config-schema-contract.test.ts` holds the schema and the
 * TypeScript type together. This module is the single place where that
 * assurance is stated to the compiler, so the suites that need a complete
 * configuration do not each repeat it.
 *
 * @example
 * ```ts
 * const config: configOptions = {...defaultConfigOptions, fontSize: 14};
 * // `config.fontSize` is 14 and every other field keeps its bundled value.
 * ```
 */

import defaultConfig from '../../app/config/config-default.json';
import type {configOptions} from '@shared/types/config';

// SAFETY: `config-default.json` is the bundled default configuration. It is
// validated against the generated schema on every load, and the schema is
// generated from `configOptions`, so the shape holds. The compiler cannot see
// past the JSON import's widened `string` literals to prove it.
export const defaultConfigOptions = defaultConfig.config as configOptions;
