/** @file Copies the bundled JSON schemas into the configuration trees. */
/*
 * A schema copy is a start-up side effect with one rule: new copies always go
 * to the Velocetty tree, and the legacy Hyper tree is refreshed only when a
 * copy is already there, so upgrading never creates a new file in it.
 */
import path from 'node:path';

/** One bundled schema and the directory and file name it takes there. */
export type SchemaTarget = Readonly<{
  readonly directory: string;
  readonly fileName: string;
  readonly source: string;
}>;

/** The filesystem subset a copy uses; required so every effect is observable. */
export type SchemaCopyFileSystem = Pick<typeof import('fs-extra'), 'copySync' | 'existsSync' | 'mkdirpSync'>;

/** What one schema copy did, so the caller owns logging and notification. */
export type SchemaCopyResult =
  | {readonly destinationPath: string; readonly kind: 'copied'}
  | {readonly destinationPath: string; readonly error: unknown; readonly kind: 'failed'};

/** What to copy and where a legacy copy may also live. */
export type SchemaCopyRequest = {
  /**
   * The filesystem the copies go through.
   *
   * Required rather than defaulted, so a caller cannot copy a schema outside
   * the port its tests observe.
   */
  readonly fs: SchemaCopyFileSystem;
  /**
   * Refreshed only where a copy already exists.
   *
   * Omitted when the legacy tree is the primary tree, so no target is written
   * twice.
   */
  readonly legacyDirectory?: string;
  readonly targets: readonly SchemaTarget[];
};

/**
 * Copies one bundled schema beside the configuration file that uses it.
 *
 * The destination directory is created first, because a fresh configuration
 * tree has no directory of its own. A failure is returned rather than thrown:
 * a stale schema degrades editor validation, it does not stop start-up, and
 * the caller decides how to report it.
 */
const copySchemaTarget = (
  {directory, fileName, source}: SchemaTarget,
  fileSystem: SchemaCopyFileSystem
): SchemaCopyResult => {
  const destinationPath = path.resolve(directory, fileName);
  try {
    fileSystem.mkdirpSync(directory);
    fileSystem.copySync(source, destinationPath, {overwrite: true});
    return {destinationPath, kind: 'copied'};
  } catch (error) {
    return {destinationPath, error, kind: 'failed'};
  }
};

/**
 * Every copy to make: the primary targets, plus the legacy copies already there.
 *
 * A legacy copy is only refreshed when a file of that name already exists, so
 * upgrading a Hyper install never creates a Velocetty schema in it.
 */
const locatedTargets = (
  {legacyDirectory, targets}: SchemaCopyRequest,
  fileSystem: SchemaCopyFileSystem
): readonly SchemaTarget[] => {
  if (legacyDirectory === undefined) {
    return targets;
  }
  const legacy = targets
    .filter((target) => fileSystem.existsSync(path.resolve(legacyDirectory, target.fileName)))
    .map((target) => ({...target, directory: legacyDirectory}));
  return [...targets, ...legacy];
};

/**
 * Copies every bundled schema into the configuration trees.
 *
 * The results are returned so the caller can log each failure and decide
 * whether the user needs one notification.
 *
 * @param request - The targets, the optional legacy tree, and the filesystem.
 * @returns One result per copy attempted, in the order the targets were built.
 *
 * @example
 * ```ts
 * const results = ensureSchemaFiles({
 *   fs,
 *   targets: [{directory: velocettyDir, fileName: 'schema.json', source: schemaPath}]
 * });
 * results.every(({kind}) => kind === 'copied'); // true when every copy landed
 * ```
 */
export const ensureSchemaFiles = (request: SchemaCopyRequest): readonly SchemaCopyResult[] =>
  locatedTargets(request, request.fs).map((target) => copySchemaTarget(target, request.fs));
