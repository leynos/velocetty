/** @file Verifies CLI API registry URL construction. */
import {beforeEach, expect, test} from 'bun:test';
import type {JsonObject} from '@shared/types/json';

import {createCliApi} from '../../cli/api';

/**
 * Registry request options as `cli/api.ts` sends them.
 *
 * Spelled out so the double's parameter matches the production client's, and
 * so the assertion below can read back exactly what the API forwarded.
 */
type RegistryRequestOptions = {
  readonly responseType: 'json';
  readonly signal: AbortSignal | undefined;
  readonly timeout: {readonly request: number};
};

let getUrl = '';
let getOptions: RegistryRequestOptions | null = null;

const buildRegistryResponse = (versions: JsonObject = {}) => ({
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
        // The unused options are declared, not dropped: the client surface is a
        // function type, and a parameterless double would be rejected against it.
        get: (url: string, _options: RegistryRequestOptions) => {
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
      get: (url: string, options: RegistryRequestOptions) => {
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
    timeout: {request: 10_000}
  });
});
