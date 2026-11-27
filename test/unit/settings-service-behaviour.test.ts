/**
 * @file Behavioural scenarios for the settings service.
 *
 * These are the file-state rules a user can reach: a healthy file, a missing
 * one, one that will not parse, one that fails the schema, and the legacy
 * `hyper.json`. Each scenario states what the settings tab is allowed to do.
 */
import {describe, expect, test} from 'bun:test';
import JSON5 from 'json5';

import {
  CONFIG_PATH,
  LEGACY_PATH,
  USER_VALUES_SCHEMA,
  appliedSnapshot,
  createHarness,
  expectReadOnly,
  harnessWithFile,
  target
} from '../testUtils/settings-service-harness';

import {fileKindFor} from '../../app/settings/settings-file-kind';
import type {SettingsService} from '../../app/settings/settings-service';
import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

type AppliedWrite = {
  readonly name: string;
  readonly initialText: string;
  readonly write: (service: SettingsService) => Promise<SettingsWriteOutcome>;
  readonly assertSnapshot: (snapshot: SettingsSnapshot) => void;
};

const APPLIED_WRITE_SCENARIOS: readonly AppliedWrite[] = [
  {
    name: 'a valid edit applies and returns the new snapshot',
    initialText: '{config: {fontSize: 14}}',
    write: (service) => service.setValue(target('fontSize'), 16),
    assertSnapshot: (snapshot) => {
      expect(snapshot.userValues).toEqual({fontSize: 16});
      expect(snapshot.revision).toBe(1);
    }
  },
  {
    name: 'a reset removes the key and reports it as no longer modified',
    initialText: '{config: {fontSize: 14, shell: "zsh"}}',
    write: (service) => service.resetValue(target('fontSize')),
    assertSnapshot: (snapshot) => {
      expect(snapshot.userValues).toEqual({shell: 'zsh'});
    }
  }
];

describe('settings snapshot', () => {
  test('reports the user values, the core defaults, and profile overrides', () => {
    const harness = createHarness();
    harness.port.setFile(
      CONFIG_PATH,
      '{config: {fontSize: 14, profiles: [{name: "default", config: {fontSize: 20}}]}}'
    );

    const snapshot = harness.service.getSnapshot();

    expect(snapshot.fileStatus).toEqual({kind: 'ok'});
    expect(snapshot.userValues).toEqual({fontSize: 14, profiles: [{name: 'default', config: {fontSize: 20}}]});
    expect(Object.keys(snapshot.defaultValues).toSorted()).toEqual(['fontSize', 'shell', 'updateChannel']);
    expect(snapshot.profileOverriddenKeys).toEqual(['fontSize']);
    expect(snapshot.filePath).toBe(CONFIG_PATH);
    expect(snapshot.revision).toBe(0);
    expectReadOnly(
      harness,
      CONFIG_PATH,
      '{config: {fontSize: 14, profiles: [{name: "default", config: {fontSize: 20}}]}}'
    );
  });

  test('reports a missing file without inventing values', () => {
    const harness = createHarness();
    const snapshot = harness.service.getSnapshot();
    expect(snapshot.fileStatus).toEqual({kind: 'missing'});
    expect(snapshot.userValues).toEqual({});
    expectReadOnly(harness, CONFIG_PATH);
  });

  test('reports an unparseable file with a diagnostic', () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {');
    const snapshot = harness.service.getSnapshot();
    expect(snapshot.fileStatus.kind).toBe('unparseable');
    if (snapshot.fileStatus.kind !== 'unparseable') {
      return;
    }
    expect(snapshot.fileStatus.diagnostics.length).toBeGreaterThan(0);
    expectReadOnly(harness, CONFIG_PATH, '{config: {');
  });

  test('reports a schema-invalid file with every diagnostic', () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {scrollback: "lots", fontSize: "big"}}');
    const snapshot = harness.service.getSnapshot();
    expect(snapshot.fileStatus.kind).toBe('invalid');
    if (snapshot.fileStatus.kind !== 'invalid') {
      return;
    }
    const paths = snapshot.fileStatus.diagnostics.map((item) => item.path).toSorted();
    expect(paths).toEqual(['/config/fontSize', '/config/scrollback']);
    expect(snapshot.userValues).toEqual({scrollback: 'lots', fontSize: 'big'});
    expectReadOnly(harness, CONFIG_PATH, '{config: {scrollback: "lots", fontSize: "big"}}');
  });

  test('reports a top-level field the load path rejects', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}, plugins: "nope"}');

    const snapshot = harness.service.getSnapshot();

    expect(snapshot.fileStatus.kind).toBe('invalid');
    if (snapshot.fileStatus.kind !== 'invalid') {
      return;
    }
    expect(snapshot.fileStatus.diagnostics.map((item) => item.path)).toEqual(['/plugins']);
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'user-config-invalid'
    });
    expectReadOnly(harness, CONFIG_PATH, '{config: {}, plugins: "nope"}');
  });

  test('reports every problem in a mixed invalid file', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {scrollback: "lots"}, plugins: "nope"}');

    const snapshot = harness.service.getSnapshot();

    expect(snapshot.fileStatus.kind).toBe('invalid');
    if (snapshot.fileStatus.kind !== 'invalid') {
      return;
    }
    expect(snapshot.fileStatus.diagnostics.map((item) => item.path).toSorted()).toEqual([
      '/config/scrollback',
      '/plugins'
    ]);
    // The diagnosed key remains repairable even though another top-level
    // field is also invalid.
    expect(await harness.service.setValue(target('scrollback'), 1000)).toMatchObject({kind: 'applied'});
  });

  test('reports a legacy hyper.json as read-only', () => {
    const harness = createHarness(LEGACY_PATH);
    harness.port.setFile(LEGACY_PATH, '{"config": {"fontSize": 14}}');
    expect(harness.service.getSnapshot().fileStatus).toEqual({kind: 'legacy-json'});
    expectReadOnly(harness, LEGACY_PATH, '{"config": {"fontSize": 14}}');
  });
});

describe('settings writes', () => {
  for (const scenario of APPLIED_WRITE_SCENARIOS) {
    test(scenario.name, async () => {
      const harness = harnessWithFile(scenario.initialText);

      const snapshot = await appliedSnapshot(scenario.write(harness.service));

      scenario.assertSnapshot(snapshot);
    });
  }

  test('a post-rename fsync failure reports unconfirmed durability', async () => {
    const harness = harnessWithFile('{config: {fontSize: 14}}');
    const writes = [
      () => harness.service.setValue(target('fontSize'), 16),
      () => harness.service.resetValue(target('fontSize'))
    ];
    for (const write of writes) {
      harness.port.queueFault('fsyncDirectory', 'EIO');
      expect(await write()).toMatchObject({kind: 'applied', durability: 'unconfirmed'});
    }
  });

  test('a policy violation is rejected with diagnostics and does not write', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');

    const outcome = await harness.service.setValue(target('scrollback'), -3);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') {
      return;
    }
    expect(outcome.diagnostics[0]?.path).toBe('/config/scrollback');
    expect(harness.port.writes).toHaveLength(0);
  });

  test('a missing file cannot be written', async () => {
    const harness = createHarness();
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'config-file-missing'
    });
  });

  test('a legacy file cannot be written and says why', async () => {
    const harness = createHarness(LEGACY_PATH);
    harness.port.setFile(LEGACY_PATH, '{"config": {}}');
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'legacy-json-config'
    });
    expect(await harness.service.resetValue(target('fontSize'))).toEqual({
      kind: 'failed',
      reason: 'legacy-json-config'
    });
  });

  test('a schema-invalid file can be fixed one diagnosed key at a time', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {scrollback: "lots", fontSize: 14}}');

    const blocked = await harness.service.setValue(target('fontSize'), 16);
    expect(blocked).toEqual({kind: 'failed', reason: 'user-config-invalid'});
    expect(harness.port.writes).toHaveLength(0);

    const fixed = await harness.service.resetValue(target('scrollback'));
    expect(fixed.kind).toBe('applied');
    if (fixed.kind !== 'applied') {
      return;
    }
    expect(fixed.snapshot.fileStatus).toEqual({kind: 'ok'});
    expect(fixed.snapshot.userValues).toEqual({fontSize: 14});
  });

  test('an unparseable file cannot be written', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {');
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'user-config-unparseable'
    });
  });

  test('a retrying write cannot be overtaken by a later write', async () => {
    const harness = harnessWithFile('{config: {fontSize: 14}}');
    // The first write's rename is busy once, so it sleeps before retrying.
    harness.port.queueFault('rename', 'EBUSY');
    const outcomes = await Promise.all([
      harness.service.setValue(target('fontSize'), 16),
      harness.service.setValue(target('fontSize'), 20)
    ]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['applied', 'applied']);
    // Without the queue the first write's retry lands last and restores 16.
    expect(JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '')).toEqual({config: {fontSize: 20}});
  });
});

/** The exact span line the recorder receives for one finished write. */
const writeSpan = (outcome: string): string => `[config] span operation=settings-write outcome=${outcome} ms=0`;
describe('settings write observability', () => {
  test('a set and a reset each count an apply, span applied, and log nothing', async () => {
    const harness = harnessWithFile('{config: {fontSize: 14}}');
    await harness.service.setValue(target('fontSize'), 16).then(() => harness.service.resetValue(target('fontSize')));
    expect(harness.counters().settingsApplies).toBe(2);
    expect(harness.spans).toEqual([writeSpan('applied'), writeSpan('applied')]);
    expect(harness.refusals).toEqual([]);
  });

  test('a rejection or a failure counts its kind and logs the closed reason', async () => {
    const rejected = harnessWithFile('{config: {}}');
    const failed = createHarness();
    await rejected.service.setValue(target('scrollback'), -3);
    await failed.service.setValue(target('fontSize'), 16);
    expect([rejected.counters().settingsRejections, failed.counters().settingsFailures]).toEqual([1, 1]);
    expect(rejected.refusals).toEqual(['settings write refused reason=not-editable']);
    expect(failed.refusals).toEqual(['settings write refused reason=config-file-missing']);
    expect([...rejected.spans, ...failed.spans]).toEqual([writeSpan('failed'), writeSpan('failed')]);
  });

  test('a file whose stat fails is refused, counted, and spanned failed', async () => {
    const harness = harnessWithFile('{config: {fontSize: 14}}');
    // The memory port fails one queued call, so each read gets its own fault.
    harness.port.queueFault('stat', 'EIO');

    // The read is total: the snapshot path needs a file state, and the write
    // path turns the same failure into a refusal rather than an exception.
    expect(harness.service.getSnapshot().fileStatus).toEqual({
      kind: 'unreadable',
      diagnostics: [
        {
          path: '/',
          message: 'The config file could not be read.',
          suggestedFix: 'Check the file permissions.'
        }
      ]
    });
    harness.port.queueFault('stat', 'EIO');
    const outcome = await harness.service.setValue(target('fontSize'), 16);

    expect(outcome.kind).not.toBe('applied');
    expect(harness.counters().settingsFailures).toBe(1);
    expect(harness.refusals).toEqual(['settings write refused reason=user-config-unreadable']);
    expect(harness.port.readFile(CONFIG_PATH)).toBe('{config: {fontSize: 14}}');
  });
});

describe('non-finite numbers in the user values', () => {
  test('encodes them so the snapshot reaches the renderer', async () => {
    const harness = harnessWithFile('{config: {fontSize: NaN, scrollback: Infinity}}');

    const snapshot = harness.service.getSnapshot();

    // The plain mapper tests the nesting; this asserts the service applies it
    // and that the diagnosed row still reaches the renderer and can be reset.
    expect(snapshot.userValues).toEqual({fontSize: 'NaN', scrollback: 'Infinity'});
    expect(USER_VALUES_SCHEMA.safeParse(snapshot.userValues).success).toBe(true);
    expect(snapshot.fileStatus.kind).toBe('invalid');
    if (snapshot.fileStatus.kind !== 'invalid') {
      return;
    }
    expect(snapshot.fileStatus.diagnostics.map((item) => item.path).toSorted()).toEqual([
      '/config/fontSize',
      '/config/scrollback'
    ]);

    const reset = await harness.service.resetValue(target('fontSize'));
    expect(reset.kind).toBe('applied');
    expect(harness.port.readFile(CONFIG_PATH)).not.toContain('fontSize');
  });
});

describe('fileKindFor', () => {
  test('a .json path is legacy and anything else is json5', () => {
    expect(fileKindFor('/home/me/.config/Hyper/hyper.json')).toBe('legacy-json');
    expect(fileKindFor('/home/me/.config/Hyper/HYPER.JSON')).toBe('legacy-json');
    expect(fileKindFor('/home/me/.config/Hyper/config.json5')).toBe('json5');
  });
});
