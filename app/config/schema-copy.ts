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

/** What to copy, where a legacy copy may also live, and how to report failure. */
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
  readonly notify: (message: string) => void;
  readonly targets: readonly SchemaTarget[];
};

/**
 * Copies one bundled schema beside the configuration file that uses it.
 *
 * The destination directory is created first, because a fresh configuration
 * tree has no directory of its own. A failure is reported and never thrown:
 * a stale schema degrades editor validation, it does not stop start-up.
 */
const copySchemaTarget = ({directory, fileName, source}: SchemaTarget, fileSystem: SchemaCopyFileSystem): boolean => {
  const destinationPath = path.resolve(directory, fileName);
  try {
    fileSystem.mkdirpSync(directory);
    fileSystem.copySync(source, destinationPath, {overwrite: true});
    return true;
  } catch (error) {
    console.error(`[config-import] Failed to copy schema file from "${source}" to "${destinationPath}".`, error);
    return false;
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
 * @param request - The targets, the optional legacy tree, and the notifier.
 *
 * @example
 * ```ts
 * ensureSchemaFiles({
 *   fs,
 *   notify,
 *   targets: [{directory: velocettyDir, fileName: 'schema.json', source: schemaPath}]
 * });
 * ```
 */
export const ensureSchemaFiles = (request: SchemaCopyRequest): void => {
  const results = locatedTargets(request, request.fs).map((target) => copySchemaTarget(target, request.fs));
  if (results.includes(false)) {
    request.notify("Couldn't update config schema metadata. Config editor validation may be stale.");
  }
};
