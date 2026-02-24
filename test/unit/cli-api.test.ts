/** @file Verifies CLI API registry URL construction. */
/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';

let existsOnNpm: typeof import('../../cli/api').existsOnNpm;
let getUrl = '';

const buildRegistryResponse = (versions: string[] = []) => ({
  body: {
    versions
  }
});

const gotMock = {
  get(url: string) {
    getUrl = url;
    return Promise.resolve(buildRegistryResponse());
  }
};

const registryUrl = () => 'https://registry.npmjs.org/';

mock.module('got', () => ({default: gotMock}));
mock.module('registry-url', () => ({default: registryUrl}));

const CLI_API_IMPORT_TIMEOUT_MS = 15_000;

beforeAll(async () => {
  ({existsOnNpm} = await import('../../cli/api'));
}, CLI_API_IMPORT_TIMEOUT_MS);

beforeEach(() => {
  getUrl = '';
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

cases.forEach(({name, packageName, expectedUrl}) => {
  test(`existsOnNpm() builds the url for ${name}`, async () => {
    await existsOnNpm(packageName);
    expect(getUrl).toBe(expectedUrl);
  });
});
