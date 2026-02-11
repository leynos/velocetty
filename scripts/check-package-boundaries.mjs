#!/usr/bin/env bun
/** @file Enforces one-way imports across frontend, backend, and shared layers. */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, extname, relative, resolve} from 'node:path';

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

const readImports = (filePath) => {
  const source = readFileSync(filePath, 'utf8');
  const importExportPattern = /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  return [...source.matchAll(importExportPattern), ...source.matchAll(dynamicImportPattern)].map((match) => match[1]);
};

const collectFiles = (directoryPath, output = []) => {
  const stats = statSync(directoryPath, {throwIfNoEntry: false});
  if (!stats || !stats.isDirectory()) {
    return output;
  }

  for (const entry of readdirSync(directoryPath)) {
    const fullPath = resolve(directoryPath, entry);
    const entryStats = statSync(fullPath);

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

        if (aliasViolation || relativeViolation) {
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
