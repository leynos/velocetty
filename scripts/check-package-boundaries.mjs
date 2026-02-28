#!/usr/bin/env bun
/** @file Enforces one-way imports across frontend, backend, and shared layers. */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, extname, relative, resolve} from 'node:path';
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

const toNormalizedRelativePath = (filePath) => relative(rootDir, filePath).replace(/\\/g, '/');

const isAllowedImportException = (filePath, importSpecifier) =>
  allowedImportExceptions.has(`${toNormalizedRelativePath(filePath)}|${importSpecifier}`);

const isSourceFile = (filePath) => sourceExtensions.has(extname(filePath));

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

const pushSpecifierIfPresent = (importSpecifiers, specifier) => {
  if (specifier !== null) {
    importSpecifiers.push(specifier);
  }
};

const handleImportExportNode = (node, importSpecifiers) => {
  const staticImportSpecifier = extractStaticImportSpecifier(node);
  pushSpecifierIfPresent(importSpecifiers, staticImportSpecifier);
};

const handleCallExpressionNode = (node, importSpecifiers) => {
  const dynamicImportSpecifier = extractDynamicImportSpecifier(node);
  pushSpecifierIfPresent(importSpecifiers, dynamicImportSpecifier);
};

const readImports = (filePath) => {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
  const importSpecifiers = [];

  const visit = (node) => {
    handleImportExportNode(node, importSpecifiers);
    handleCallExpressionNode(node, importSpecifiers);

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return importSpecifiers;
};

const collectFiles = (directoryPath, output = []) => {
  const directoryStats = statSync(directoryPath, {throwIfNoEntry: false});
  if (!directoryStats || !directoryStats.isDirectory()) {
    return output;
  }

  for (const entry of readdirSync(directoryPath)) {
    const fullPath = resolve(directoryPath, entry);
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
  const relativePath = relative(rootDir, filePath).replace(/\\/g, '/');

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

  const candidate = resolve(dirname(fromFile), importSpecifier).replace(/\\/g, '/');
  const relativeCandidate = relative(rootDir, candidate).replace(/\\/g, '/');

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

const violations = [];

for (const roots of Object.values(layerDefinitions)) {
  for (const root of roots) {
    for (const filePath of collectFiles(resolve(rootDir, root))) {
      const layer = getLayerForFile(filePath);
      if (!layer) {
        continue;
      }

      const rules = layerRules[layer];
      for (const importSpecifier of readImports(filePath)) {
        if (isAllowedImportException(filePath, importSpecifier)) {
          continue;
        }

        const aliasViolation = isDisallowedAliasSpecifier(importSpecifier, rules.disallowedAliases);
        const relativeViolation = resolvesToDisallowedRoot(filePath, importSpecifier, rules.disallowedRoots);
        const bareRootViolation = isBareDisallowedRootSpecifier(importSpecifier, rules.disallowedRoots);

        if (aliasViolation || relativeViolation || bareRootViolation) {
          violations.push({
            file: relative(rootDir, filePath),
            importSpecifier,
            layer
          });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Package boundary violations found:');
  for (const violation of violations) {
    console.error(`- [${violation.layer}] ${violation.file}: ${violation.importSpecifier}`);
  }
  process.exit(1);
}

console.log('Package boundary check passed.');
