#!/usr/bin/env bun
/** @file Enforces one-way imports across frontend, backend, and shared layers. */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const rootDir = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);

const layerDefinitions = {
  frontend: ['frontend/src', 'lib'],
  backend: ['backend/src', 'app'],
  shared: ['shared/src']
};

const layerRules = {
  frontend: {
    disallowedAliases: ['@backend/'],
    disallowedRoots: ['backend', 'app']
  },
  backend: {
    disallowedAliases: ['@frontend/'],
    disallowedRoots: ['frontend', 'lib']
  },
  shared: {
    disallowedAliases: ['@frontend/', '@backend/'],
    disallowedRoots: ['frontend', 'backend', 'lib', 'app']
  }
};

const allowedImportExceptions = new Set(['lib/components/term.tsx|../../app/utils/renderer-utils']);

const toNormalizedRelativePath = (filePath) => path.relative(rootDir, filePath).replaceAll('\\', '/');

const isAllowedImportException = (filePath, importSpecifier) =>
  allowedImportExceptions.has(`${toNormalizedRelativePath(filePath)}|${importSpecifier}`);

const isSourceFile = (filePath) => sourceExtensions.has(path.extname(filePath));

const getScriptKind = (filePath) => {
  if (filePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }

  if (filePath.endsWith('.mts')) {
    return ts.ScriptKind.MTS;
  }

  if (filePath.endsWith('.cts')) {
    return ts.ScriptKind.CTS;
  }

  return ts.ScriptKind.TS;
};

const isStaticImportOrExport = (node) =>
  (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && Boolean(node.moduleSpecifier);

const extractStaticImportSpecifier = (node) => {
  if (!isStaticImportOrExport(node)) {
    return null;
  }

  if (!ts.isStringLiteralLike(node.moduleSpecifier)) {
    return null;
  }

  return node.moduleSpecifier.text;
};

/**
 * Reports whether a static import or re-export survives compilation.
 *
 * Only a clause-level `import type` (or `export type`) is erased outright.
 * `import {type A} from 'x'` is not: `verbatimModuleSyntax` keeps the
 * statement as `import {} from 'x'`, which still resolves `x` at runtime.
 */
const isTypeOnlyStaticImportOrExport = (node) => {
  if (ts.isImportDeclaration(node)) {
    return node.importClause?.isTypeOnly === true;
  }

  return ts.isExportDeclaration(node) && node.isTypeOnly;
};

const isDynamicImportCall = (node) =>
  ts.isCallExpression(node) && node.arguments.length === 1 && node.expression.kind === ts.SyntaxKind.ImportKeyword;

const isCommonJsRequireCall = (node) =>
  ts.isCallExpression(node) &&
  node.arguments.length === 1 &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'require';

const extractDynamicImportSpecifier = (node) => {
  if (!isDynamicImportCall(node) && !isCommonJsRequireCall(node)) {
    return null;
  }

  const [firstArgument] = node.arguments;
  if (!ts.isStringLiteralLike(firstArgument)) {
    return null;
  }

  return firstArgument.text;
};

const pushSpecifierIfPresent = (imports, specifier, isTypeOnly = false) => {
  if (specifier !== null) {
    imports.push({isTypeOnly, specifier});
  }
};

const handleImportExportNode = (node, imports) => {
  const staticImportSpecifier = extractStaticImportSpecifier(node);
  pushSpecifierIfPresent(imports, staticImportSpecifier, isTypeOnlyStaticImportOrExport(node));
};

const handleCallExpressionNode = (node, imports) => {
  const dynamicImportSpecifier = extractDynamicImportSpecifier(node);
  pushSpecifierIfPresent(imports, dynamicImportSpecifier);
};

const readImports = (filePath) => {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
  const imports = [];

  const visit = (node) => {
    handleImportExportNode(node, imports);
    handleCallExpressionNode(node, imports);

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return imports;
};

const collectFiles = (directoryPath, output = []) => {
  const directoryStats = statSync(directoryPath, {throwIfNoEntry: false});
  if (!directoryStats || !directoryStats.isDirectory()) {
    return output;
  }

  for (const entry of readdirSync(directoryPath)) {
    const fullPath = path.resolve(directoryPath, entry);
    const entryStats = statSync(fullPath, {throwIfNoEntry: false});
    if (!entryStats) {
      continue;
    }

    if (entryStats.isDirectory()) {
      collectFiles(fullPath, output);
      continue;
    }

    if (isSourceFile(fullPath)) {
      output.push(fullPath);
    }
  }

  return output;
};

const getLayerForFile = (filePath) => {
  const relativePath = path.relative(rootDir, filePath).replaceAll('\\', '/');

  for (const [layerName, roots] of Object.entries(layerDefinitions)) {
    if (roots.some((root) => relativePath.startsWith(`${root}/`))) {
      return layerName;
    }
  }

  return null;
};

const resolvesToDisallowedRoot = (fromFile, importSpecifier, disallowedRoots) => {
  if (!importSpecifier.startsWith('.')) {
    return false;
  }

  const candidate = path.resolve(path.dirname(fromFile), importSpecifier).replaceAll('\\', '/');
  const relativeCandidate = path.relative(rootDir, candidate).replaceAll('\\', '/');

  return disallowedRoots.some((root) => relativeCandidate.startsWith(`${root}/`) || relativeCandidate === root);
};

const isNonBareImport = (specifier) => {
  const isRelativePath = specifier.startsWith('.');
  const isScopedPackage = specifier.startsWith('@');
  const isProtocolImport = specifier.includes(':');

  return isRelativePath || isScopedPackage || isProtocolImport;
};

const isBareDisallowedRootSpecifier = (importSpecifier, disallowedRoots) => {
  if (isNonBareImport(importSpecifier)) {
    return false;
  }

  return disallowedRoots.some((root) => importSpecifier === root || importSpecifier.startsWith(`${root}/`));
};

const isDisallowedAliasSpecifier = (importSpecifier, disallowedAliases) =>
  disallowedAliases.some((aliasPrefix) => {
    const aliasRoot = aliasPrefix.endsWith('/') ? aliasPrefix.slice(0, -1) : aliasPrefix;
    return importSpecifier === aliasRoot || importSpecifier.startsWith(aliasPrefix);
  });

/**
 * `app/` is compiled by `tsgo` into `dist/app`, where the `@shared/*` alias
 * has no runtime counterpart, so a value import type-checks and then throws
 * `MODULE_NOT_FOUND` in the packaged application. Only `tsgo`-compiled app
 * code is affected; the renderer and CLI bundles alias `@shared` themselves.
 */
const isAppSharedRuntimeImport = (filePath, importSpecifier, isTypeOnly) =>
  toNormalizedRelativePath(filePath).startsWith('app/') &&
  !isTypeOnly &&
  isDisallowedAliasSpecifier(importSpecifier, ['@shared/']);

const violations = [];

for (const roots of Object.values(layerDefinitions)) {
  for (const root of roots) {
    for (const filePath of collectFiles(path.resolve(rootDir, root))) {
      const layer = getLayerForFile(filePath);
      if (!layer) {
        continue;
      }

      const rules = layerRules[layer];
      for (const {isTypeOnly, specifier: importSpecifier} of readImports(filePath)) {
        if (isAllowedImportException(filePath, importSpecifier)) {
          continue;
        }

        const aliasViolation = isDisallowedAliasSpecifier(importSpecifier, rules.disallowedAliases);
        const relativeViolation = resolvesToDisallowedRoot(filePath, importSpecifier, rules.disallowedRoots);
        const bareRootViolation = isBareDisallowedRootSpecifier(importSpecifier, rules.disallowedRoots);
        const sharedRuntimeViolation = isAppSharedRuntimeImport(filePath, importSpecifier, isTypeOnly);

        if (aliasViolation || relativeViolation || bareRootViolation || sharedRuntimeViolation) {
          violations.push({
            file: path.relative(rootDir, filePath),
            importSpecifier,
            layer,
            reason: sharedRuntimeViolation ? 'runtime `@shared/*` import in app/' : null
          });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Package boundary violations found:');
  for (const violation of violations) {
    const suffix = violation.reason === null ? '' : ` (${violation.reason})`;
    console.error(`- [${violation.layer}] ${violation.file}: ${violation.importSpecifier}${suffix}`);
  }
  process.exit(1);
}

console.log('Package boundary check passed.');
