// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {afterAll, beforeAll, expect, mock, test} from 'bun:test';

import {mockElectronModule} from '../testUtils/electron-path';

type Display = {
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const screenStub = {
  getAllDisplays: (): Display[] => []
};

mockElectronModule(() => ({default: {screen: screenStub}}));

let positionIsValid: typeof import('../../app/utils/window-utils').positionIsValid;

beforeAll(async () => {
  ({positionIsValid} = await import('../../app/utils/window-utils'));
});

afterAll(() => {
  mock.restore();
});

test('positionIsValid() returns true when window is on only screen', () => {
  const position = [50, 50];
  screenStub.getAllDisplays = () => {
    return [
      {
        workArea: {
          x: 0,
          y: 0,
          width: 500,
          height: 500
        }
      }
    ];
  };

  const result = positionIsValid(position);

  expect(result).toBe(true);
});

test('positionIsValid() returns true when window is on second screen', () => {
  const position = [750, 50];
  screenStub.getAllDisplays = () => {
    return [
      {
        workArea: {
          x: 0,
          y: 0,
          width: 500,
          height: 500
        }
      },
      {
        workArea: {
          x: 500,
          y: 0,
          width: 500,
          height: 500
        }
      }
    ];
  };

  const result = positionIsValid(position);

  expect(result).toBe(true);
});

test('positionIsValid() returns false when position isnt valid', () => {
  const primaryDisplay = {
    workArea: {
      x: 0,
      y: 0,
      width: 500,
      height: 500
    }
  };
  const position = [600, 50];
  screenStub.getAllDisplays = () => {
    return [primaryDisplay];
  };

  const result = positionIsValid(position);

  expect(result).toBe(false);
});
