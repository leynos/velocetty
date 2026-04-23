/** @file Shared helpers for detecting forbidden styled-jsx residue in built artefacts. */
import fs from 'node:fs/promises';

export type ForbiddenResiduePattern = Readonly<{
  label: string;
  pattern: RegExp;
}>;

export type StyledJsxResidueMatch = Readonly<{
  relativePath: string;
  labels: string[];
}>;

export const styledJsxResiduePatterns: readonly ForbiddenResiduePattern[] = [
  {label: 'styled-jsx/style', pattern: /styled-jsx\/style/},
  {label: 'styled-jsx', pattern: /styled-jsx/},
  {label: '<style jsx', pattern: /<style\s+jsx\b/i}
];

const findMatchingLabels = (contents: string, patterns: readonly ForbiddenResiduePattern[]) =>
  patterns.filter(({pattern}) => pattern.test(contents)).map(({label}) => label);

export const inspectFileForStyledJsxResidue = async (
  relativePath: string,
  patterns: readonly ForbiddenResiduePattern[] = styledJsxResiduePatterns
) => {
  const contents = await fs.readFile(relativePath, 'utf8');
  return {
    relativePath,
    labels: findMatchingLabels(contents, patterns)
  } satisfies StyledJsxResidueMatch;
};

export const collectStyledJsxResidueMatches = async (
  relativePaths: readonly string[],
  patterns: readonly ForbiddenResiduePattern[] = styledJsxResiduePatterns
) => {
  const inspections = await Promise.all(
    relativePaths.map((relativePath) => inspectFileForStyledJsxResidue(relativePath, patterns))
  );
  return inspections.filter((inspection) => inspection.labels.length > 0);
};

export const formatStyledJsxResidueMatches = (matches: readonly StyledJsxResidueMatch[]) =>
  matches.map(({relativePath, labels}) => `${relativePath} [${labels.join(', ')}]`);
