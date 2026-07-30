/** @file Fast-E2E contracts for packaged renderer artefact cleanliness. */
import {collectStyledJsxResidueMatches, formatStyledJsxResidueMatches} from '../testUtils/styled-jsx-residue';

const packagedRendererArtefacts = ['dist/app/renderer/bundle.js', 'dist/app/renderer/bundle.css'] as const;

export const assertPackagedRendererOutputHasNoStyledJsxResidue = async () => {
  const matches = await collectStyledJsxResidueMatches(packagedRendererArtefacts);
  if (matches.length === 0) {
    return;
  }

  throw new Error(
    'Packaged renderer output still contains styled-jsx residue in: ' +
      formatStyledJsxResidueMatches(matches).join(', ')
  );
};
