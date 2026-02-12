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

const readImports = (filePath) => {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
  const importSpecifiers = [];

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) {
        importSpecifiers.push(node.moduleSpecifier.text);
      }
    }

    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [firstArgument] = node.arguments;
      if (ts.isStringLiteralLike(firstArgument)) {
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isCommonJsRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';

        if (isDynamicImport || isCommonJsRequire) {
          importSpecifiers.push(firstArgument.text);
        }
      }
    }

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

const isBareDisallowedRootSpecifier = (importSpecifier, disallowedRoots) => {
  if (importSpecifier.startsWith('.') || importSpecifier.startsWith('@') || importSpecifier.includes(':')) {
    return false;
  }

  return disallowedRoots.some((root) => importSpecifier === root || importSpecifier.startsWith(`${root}/`));
};

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
        const aliasViolation = rules.disallowedAliases.some((aliasPrefix) => importSpecifier.startsWith(aliasPrefix));
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
