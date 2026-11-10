/** @file Composition checks for the defaults the `app/config.ts` root wires in. */
/*
 * The pure colour helpers are covered by `colours.test.ts`. What only the
 * composition root can get wrong is the wiring: which bundled value it passes,
 * and what it does when the bundled file supplied none.
 */
import {expect, mock, test} from 'bun:test';

import type {ColorMap, configOptions} from '@shared/types/config';

import {fallbackColors} from '../../app/utils/colours';
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

test.serial('fixConfigDefaults layers the applied colours under the user colours', async () => {
  const harness = await createWatchHarness();
  try {
    const fixed = harness.configModule.fixConfigDefaults(configWith({black: '#111111'}), {
      black: '#123456',
      red: '#654321'
    });

    // The user's value wins, the applied palette supplies the rest, and slots
    // neither sets come from the last-resort palette, so the map is complete
    // for xterm. Comparing the whole map proves the third layer fills every
    // remaining slot, not only the two this fixture happens to name.
    expect(fixed.colors).toEqual({...fallbackColors(), black: '#111111', red: '#654321'});
  } finally {
    mock.restore();
  }
});

test.serial('fixConfigDefaults keeps the user colours when no palette was applied', async () => {
  const harness = await createWatchHarness();
  try {
    const fixed = harness.configModule.fixConfigDefaults(configWith({black: '#111111'}));

    // A bundled file that could not be read or parsed has no `config` section,
    // so the composition root passes no palette rather than dereferencing an
    // absent colour map. The last-resort palette still fills every slot the
    // user left unset, which whole-map equality states once for every slot.
    expect(fixed.colors).toEqual({...fallbackColors(), black: '#111111'});
  } finally {
    mock.restore();
  }
});

test.serial('decoration reads no bundled file, so a later fault cannot change the colours', async () => {
  const harness = await createWatchHarness();
  try {
    // The palette is whatever the import applied. The stub importer exposes no
    // defaults query at all, so a decoration that went back to the bundled
    // file would throw here instead of quietly returning different colours.
    const first = harness.configModule.fixConfigDefaults(configWith({}), {black: '#123456'});
    const second = harness.configModule.fixConfigDefaults(configWith({}), {black: '#123456'});

    expect(first.colors).toEqual(second.colors);
    expect(first.colors.black).toBe('#123456');
  } finally {
    mock.restore();
  }
});
