/** @file Verifies CLI API registry URL construction. */
import {beforeEach, expect, test} from 'bun:test';

import {createCliApi} from '../../cli/api';

let getUrl = '';

const buildRegistryResponse = (versions: Record<string, unknown> = {}) => ({
  body: {
    versions
  }
});

const cases = [
  {
    name: 'non-scoped packages',
    packageName: 'pkg',
    expectedUrl: 'https://registry.npmjs.org/pkg'
  },
  {
    name: 'scoped packages',
    packageName: '@scope/pkg',
    expectedUrl: 'https://registry.npmjs.org/@scope%2fpkg'
  }
];

beforeEach(() => {
  getUrl = '';
});

cases.forEach(({name, packageName, expectedUrl}) => {
  test(`existsOnNpm() builds the url for ${name}`, async () => {
    const api = createCliApi({
      gotClient: {
        get(url: string) {
          getUrl = url;
          return Promise.resolve(buildRegistryResponse());
        }
      },
      registryUrl: 'https://registry.npmjs.org/'
    });

    await api.existsOnNpm(packageName);
    expect(getUrl).toBe(expectedUrl);
  });
});
