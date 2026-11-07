/** @file Composition checks for the defaults the `app/config.ts` root wires in. */
/*
 * The pure colour helpers are covered by `colours.test.ts`. What only the
 * composition root can get wrong is the wiring: which bundled value it passes,
 * and what it does when the bundled file supplied none.
 */
import {expect, mock, test} from 'bun:test';

import type {ColorMap, configOptions} from '@shared/types/config';

import {createWatchHarness} from '../testUtils/config-watch-harness';

/**
 * A configuration stub carrying only the property `fixConfigDefaults` reads.
 *
 * The colour map is partial because that is what a user config supplies: the
 * function under test is what fills the remaining slots.
 */
const configWith = (colors: Partial<ColorMap>): configOptions =>
  // SAFETY: `fixConfigDefaults` reads and writes `colors` only, and the cast
  // keeps the fixture from restating every unrelated option.
  ({colors}) as configOptions;

test.serial('fixConfigDefaults layers the bundled colours under the user colours', async () => {
  const harness = await createWatchHarness({bundledColors: {black: '#123456', red: '#654321'}});
  try {
    const fixed = harness.configModule.fixConfigDefaults(configWith({black: '#111111'}));

    // The user's value wins, the bundled configuration supplies the rest, and
    // slots neither sets come from the last-resort palette, so the map is
    // complete for xterm.
    expect(fixed.colors).toMatchObject({black: '#111111', red: '#654321', white: '#C7C7C7'});
  } finally {
    mock.restore();
  }
});

test.serial('fixConfigDefaults keeps the user colours when the bundled config has none', async () => {
  const harness = await createWatchHarness();
  try {
    const fixed = harness.configModule.fixConfigDefaults(configWith({black: '#111111'}));

    // A bundled file that could not be read or parsed has no `config` section,
    // so the composition root must not dereference an absent colour map. The
    // last-resort palette still fills every slot the user left unset.
    expect(fixed.colors).toMatchObject({black: '#111111', white: '#C7C7C7'});
  } finally {
    mock.restore();
  }
});
