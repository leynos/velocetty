/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';

let existsOnNpm: typeof import('../../cli/api').existsOnNpm;
let getUrl = '';

const gotMock = {
  get(url: string) {
    getUrl = url;
    return Promise.resolve({
      body: {
        versions: []
      }
    });
  }
};

const registryUrl = () => 'https://registry.npmjs.org/';

mock.module('got', () => ({default: gotMock}));
mock.module('registry-url', () => ({default: registryUrl}));

beforeAll(async () => {
  ({existsOnNpm} = await import('../../cli/api'));
});

beforeEach(() => {
  getUrl = '';
});

test('existsOnNpm() builds the url for non-scoped packages', async () => {
  await existsOnNpm('pkg');
  expect(getUrl).toBe('https://registry.npmjs.org/pkg');
});

test('existsOnNpm() builds the url for scoped packages', async () => {
  await existsOnNpm('@scope/pkg');
  expect(getUrl).toBe('https://registry.npmjs.org/@scope%2fpkg');
});
