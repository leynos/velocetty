/** @file KB-PATH-2: the app and shared configuration-tree resolvers must agree everywhere. */
import {describe, expect, test} from 'bun:test';

import {resolveConfigLocations as resolveAppConfigLocations} from '../../app/config/config-tree';
import {resolveConfigLocations as resolveSharedConfigLocations} from '../../shared/src/config/config-tree';
import {buildConfigTreeCases} from '../testUtils/config-tree-domain';

const cases = buildConfigTreeCases();

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

  test('covers the whole 768-case domain', () => {
    expect(cases).toHaveLength(768);
  });

  test('exercises every active tree', () => {
    const trees = new Set(cases.map((testCase) => resolveSharedConfigLocations(testCase.input).config.tree));

    expect([...trees].toSorted()).toEqual(['development', 'hyper', 'velocetty']);
  });
});
