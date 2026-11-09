/** @file KB-PATH-2: the app and shared configuration-tree resolvers must agree everywhere. */
import {describe, expect, test} from 'bun:test';

import {resolveConfigLocations as resolveAppConfigLocations} from '../../app/config/config-tree';
import {resolveConfigLocations as resolveSharedConfigLocations} from '../../shared/src/config/config-tree';
import {buildConfigTreeCases, platformPath, type ConfigTreeCase} from '../testUtils/config-tree-domain';

const cases = buildConfigTreeCases();

/**
 * Every candidate path the resolver can be asked about for one case.
 *
 * Each is probed as `inaccessible` in turn, so the parity suite covers the
 * state the present/absent enumeration cannot express.
 */
const candidatePaths = (testCase: ConfigTreeCase): string[] => {
  const paths = platformPath(testCase.platform);
  return [
    paths.join(testCase.developmentDirectory, 'config.json5'),
    paths.join(testCase.developmentDirectory, 'hyper.json'),
    paths.join(testCase.velocettyDirectory, 'config.json5'),
    paths.join(testCase.hyperDirectory, 'config.json5'),
    paths.join(testCase.hyperDirectory, 'hyper.json')
  ];
};

describe('KB-PATH-2 configuration tree parity', () => {
  test('returns identical locations for every enumerated case', () => {
    const mismatches: string[] = [];

    for (const testCase of cases) {
      const appResult = resolveAppConfigLocations(testCase.input);
      const sharedResult = resolveSharedConfigLocations(testCase.input);
      if (JSON.stringify(appResult) !== JSON.stringify(sharedResult)) {
        mismatches.push(`${testCase.label}: app ${JSON.stringify(appResult)}; shared ${JSON.stringify(sharedResult)}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  test('returns identical locations when a candidate cannot be inspected', () => {
    const mismatches: string[] = [];

    for (const testCase of cases) {
      for (const inaccessible of candidatePaths(testCase)) {
        const input = {
          ...testCase.input,
          probe: (candidate: string) =>
            candidate === inaccessible ? ('inaccessible' as const) : testCase.input.probe(candidate)
        };
        const appResult = resolveAppConfigLocations(input);
        const sharedResult = resolveSharedConfigLocations(input);
        if (JSON.stringify(appResult) !== JSON.stringify(sharedResult)) {
          mismatches.push(
            `${testCase.label} inaccessible=${inaccessible}: app ${JSON.stringify(appResult)}; ` +
              `shared ${JSON.stringify(sharedResult)}`
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  test('covers the whole 768-case domain', () => {
    expect(cases).toHaveLength(768);
  });

  test('exercises every active tree', () => {
    const trees = new Set(cases.map((testCase) => resolveSharedConfigLocations(testCase.input).config.tree));

    expect([...trees].toSorted()).toEqual(['development', 'hyper', 'velocetty']);
  });
});
