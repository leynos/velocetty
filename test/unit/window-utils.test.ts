/** @file Verifies window position validation against display layouts. */
// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {beforeAll, beforeEach, expect, test} from 'bun:test';

import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';

type Display = {
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type Position = [number, number];

const screenStub = {
  getAllDisplays: (): Display[] => []
};

registerElectronMock();
const electronMock = getElectronMock();
electronMock.default.screen = screenStub;

let positionIsValid: typeof import('../../app/utils/window-utils').positionIsValid;

beforeAll(async () => {
  ({positionIsValid} = await import('../../app/utils/window-utils'));
});

beforeEach(() => {
  resetElectronMock();
  electronMock.default.screen = screenStub;
});

const buildDisplay = (x: number, y: number, width: number, height: number): Display => ({
  workArea: {x, y, width, height}
});

const setDisplays = (displays: Display[]) => {
  screenStub.getAllDisplays = () => displays;
};

const cases: Array<{
  name: string;
  position: Position;
  displays: Display[];
  expected: boolean;
}> = [
  {
    name: 'positionIsValid() returns true when window is on only screen',
    position: [50, 50],
    displays: [buildDisplay(0, 0, 500, 500)],
    expected: true
  },
  {
    name: 'positionIsValid() returns true when window is on second screen',
    position: [750, 50],
    displays: [buildDisplay(0, 0, 500, 500), buildDisplay(500, 0, 500, 500)],
    expected: true
  },
  {
    name: 'positionIsValid() returns false when position is not valid',
    position: [600, 50],
    displays: [buildDisplay(0, 0, 500, 500)],
    expected: false
  }
];

cases.forEach(({name, position, displays, expected}) => {
  test(name, () => {
    setDisplays(displays);
    const result = positionIsValid(position);
    expect(result).toBe(expected);
  });
});
