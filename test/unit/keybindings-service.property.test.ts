/** @file KB-SVC-1 import and export laws as fast-check properties. */
import {expect, test} from 'bun:test';
import fc from 'fast-check';

import {createKeybindingsService} from '../../app/config/keybindings';
import {parseKeybindingsText, serializeKeybindings} from '../../app/config/keybindings-codec';
import {createMemoryKeybindingsStore} from '../testUtils/memory-keybindings-store';
import {KEYBINDINGS_PROPERTY_SEED, keymapsArb, textDocArb} from '../testUtils/keybindings-arbitraries';

const SOURCE = 'property-keybindings.json5';
const PROPERTY_RUNS = 200;
const PROPERTY_OPTIONS = {numRuns: PROPERTY_RUNS, seed: KEYBINDINGS_PROPERTY_SEED} as const;
const SEED_TEXT = serializeKeybindings({'seed:command': 'ctrl+s'});

const validTextArb = fc.oneof(
  keymapsArb.map((keymaps) => serializeKeybindings(keymaps)),
  // Compact JSON5 is valid but not the serializer's canonical form, so the
  // verbatim law rejects any service that rewrites text on import.
  keymapsArb.map((keymaps) => JSON.stringify(keymaps))
);

const parseOrThrow = (text: string) => {
  const parsed = parseKeybindingsText(text, SOURCE);
  if (parsed.kind !== 'ok') {
    throw new Error(`Expected valid text in a valid-text property: ${text}`);
  }
  return parsed.keymaps;
};

const invalidTextArb = textDocArb.filter((text) => parseKeybindingsText(text, SOURCE).kind === 'invalid');

const startService = (initialText: string) => {
  const store = createMemoryKeybindingsStore();
  store.setText(initialText);
  const notifications: string[] = [];
  const service = createKeybindingsService({
    notify: (title) => {
      notifications.push(title);
    },
    store
  });
  service.start({kind: 'parsed-empty'});
  return {notifications, service, store};
};

test('KB-SVC-1 a valid import is written verbatim and applies on reload', () => {
  fc.assert(
    fc.property(validTextArb, (text) => {
      const {service, store} = startService(SEED_TEXT);
      const before = service.active();
      const attemptsBefore = store.writeAttempts();

      expect(service.importKeybindings(text, SOURCE)).toEqual({kind: 'written'});
      expect(store.writtenTexts()).toEqual([text]);
      expect(store.writeAttempts()).toBe(attemptsBefore + 1);
      expect(service.active()).toEqual(before);

      const reloaded = service.reload();
      expect(reloaded.kind).toBe('applied');
      expect(service.active()).toEqual(parseOrThrow(text));
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-SVC-1 an invalid import writes nothing and changes nothing', () => {
  fc.assert(
    fc.property(invalidTextArb, (text) => {
      const {service, store} = startService(SEED_TEXT);
      const before = service.active();
      const attemptsBefore = store.writeAttempts();

      const outcome = service.importKeybindings(text, SOURCE);

      expect(outcome.kind).toBe('invalid');
      if (outcome.kind === 'invalid') {
        expect(outcome.diagnostics.length).toBeGreaterThan(0);
      }
      expect(store.writeAttempts()).toBe(attemptsBefore);
      expect(service.active()).toEqual(before);
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-SVC-1 a failed import leaves the stored text and state unchanged', () => {
  fc.assert(
    fc.property(validTextArb, (text) => {
      const {service, store} = startService(SEED_TEXT);
      const before = service.active();
      store.failNextWrite();

      const outcome = service.importKeybindings(text, SOURCE);

      expect(outcome.kind).toBe('failed');
      expect(service.exportKeybindings()).toEqual({kind: 'stored', text: SEED_TEXT});
      expect(service.active()).toEqual(before);
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-SVC-1 export reports the stored text without writing or notifying', () => {
  fc.assert(
    fc.property(validTextArb, (text) => {
      const {notifications, service, store} = startService(SEED_TEXT);
      const before = service.active();
      store.setText(text);
      const attemptsBefore = store.writeAttempts();
      const notificationsBefore = notifications.length;

      expect(service.exportKeybindings()).toEqual({kind: 'stored', text});
      expect(store.writeAttempts()).toBe(attemptsBefore);
      expect(notifications).toHaveLength(notificationsBefore);
      expect(service.active()).toEqual(before);
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-SVC-1 export reports invalid text with the parser diagnostics', () => {
  fc.assert(
    fc.property(invalidTextArb, (text) => {
      const {notifications, service, store} = startService(SEED_TEXT);
      const before = service.active();
      store.setText(text);
      const expected = parseKeybindingsText(text, store.location);
      const notificationsBefore = notifications.length;

      const outcome = service.exportKeybindings();

      expect(outcome).toMatchObject({kind: 'invalid', text});
      if (outcome.kind === 'invalid' && expected.kind === 'invalid') {
        expect(outcome.diagnostics).toEqual(expected.diagnostics);
      }
      expect(store.writeAttempts()).toBe(0);
      expect(notifications).toHaveLength(notificationsBefore);
      expect(service.active()).toEqual(before);
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-SVC-1 export reports missing and unreadable stores', () => {
  const missing = startService(SEED_TEXT);
  missing.store.setMissing();
  expect(missing.service.exportKeybindings()).toEqual({kind: 'missing'});

  const unreadable = startService(SEED_TEXT);
  unreadable.store.setUnreadable();
  expect(unreadable.service.exportKeybindings()).toMatchObject({kind: 'unreadable'});
});

test('KB-SVC-1 coverage: valid and invalid documents are each well represented', () => {
  const samples = fc.sample(textDocArb, {numRuns: 2000, seed: KEYBINDINGS_PROPERTY_SEED});
  const outcomes = samples.map((text) => parseKeybindingsText(text, SOURCE).kind);
  const accepted = outcomes.filter((kind) => kind === 'ok').length / outcomes.length;
  const rejected = outcomes.filter((kind) => kind === 'invalid').length / outcomes.length;

  expect(accepted).toBeGreaterThan(0.2);
  expect(rejected).toBeGreaterThan(0.2);
});
