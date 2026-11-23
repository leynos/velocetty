/** @file Compile-time contracts for the configuration path brand, checked by `bun check:types`. */
import {expect, test} from 'bun:test';

import {
  createPathProbe,
  type ConfigLocationInput,
  type ConfigPath,
  type ProbeState
} from '../../app/config/config-tree';
import {
  createPathProbe as createSharedPathProbe,
  type ConfigLocationInput as SharedLocationInput,
  type ConfigPath as SharedConfigPath
} from '../../shared/src/config/config-tree';

/** A probe that reports absence; it exists to exercise the parameter's brand. */
const absentProbe: ConfigLocationInput['probe'] = () => 'absent';

/** The shared copy's probe, with the same shape and purpose. */
const absentSharedProbe: SharedLocationInput['probe'] = () => 'absent';

/**
 * Statements the runtime never executes; `tsgo` checks them during the build.
 *
 * The `@ts-expect-error` comments fail the type check if the mismatch they
 * describe stops being an error, so a brand that quietly widened would be
 * caught here rather than at a probe call site that then accepted any string.
 */
const assertTypeContracts = (): void => {
  // SAFETY: the assertion only exercises assignability; no path is probed.
  const aConfigPath = '/home/ada/.config/Velocetty/config.json5' as ConfigPath;

  // A branded path remains a string, so callers can join, compare, and print it.
  const asString: string = aConfigPath;
  void asString;

  // The probe is asked only about paths the resolver built and branded.
  const state: ProbeState = absentProbe(aConfigPath);
  void state;
  // @ts-expect-error an ordinary string is not a path the resolver built
  absentProbe('/home/ada/.config/Hyper/config.json5');

  // The production probe satisfies the resolver's input without a re-brand.
  const built: ConfigLocationInput['probe'] = createPathProbe({
    lstatSync: () => ({}),
    statSync: () => ({})
  });
  void built;

  // The shared copy brands its paths the same way, with the same probe shape.
  // SAFETY: as above, the assertion only exercises assignability.
  const aSharedConfigPath = '/home/ada/.config/Velocetty/config.json5' as SharedConfigPath;
  const asSharedString: string = aSharedConfigPath;
  void asSharedString;
  const sharedState: ProbeState = absentSharedProbe(aSharedConfigPath);
  void sharedState;
  // @ts-expect-error the shared resolver brands its own paths
  absentSharedProbe('/home/ada/.config/Hyper/config.json5');
  const sharedBuilt: SharedLocationInput['probe'] = createSharedPathProbe({
    lstatSync: () => ({}),
    statSync: () => ({})
  });
  void sharedBuilt;
};

test('the configuration path contracts compile', () => {
  expect(assertTypeContracts).toBeFunction();
});
