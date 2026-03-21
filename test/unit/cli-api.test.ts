/** @file Verifies CLI API registry URL construction. */
import {beforeEach, expect, test} from 'bun:test';

import {createCliApi} from '../../cli/api';

let getUrl = '';
let getOptions: {
  readonly responseType?: string;
  readonly signal?: AbortSignal;
  readonly timeout?: {
    readonly request?: number;
  };
} | null = null;

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
  getOptions = null;
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

test('existsOnNpm() forwards AbortSignal and timeout options to the registry client', async () => {
  const controller = new AbortController();
  const api = createCliApi({
    gotClient: {
      get(url: string, options) {
        getUrl = url;
        getOptions = options;
        return Promise.resolve(buildRegistryResponse());
      }
    },
    registryUrl: 'https://registry.npmjs.org/'
  });

  await api.existsOnNpm('some-package', controller.signal);

  expect(getUrl).toBe('https://registry.npmjs.org/some-package');
  expect(getOptions).toMatchObject({
    responseType: 'json',
    signal: controller.signal,
    timeout: {request: 10000}
  });
});
