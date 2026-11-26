/**
 * @file A ref-backed store of per-field edit state.
 *
 * React reducers must stay pure and StrictMode invokes them twice, so the
 * reviewed state machine (`shared/src/settings/field-state.ts`) runs here,
 * outside React, and its effects are executed by this store after the new
 * state is applied. Components read the store through `useSyncExternalStore`.
 *
 * A submitted or reset field holds the request id its outcome must match, so a
 * late answer for a superseded request cannot overwrite a newer draft.
 */

import {coerceInput, formatValue, type CoercionFailure, type SettingValue} from '@shared/settings/coerce';
import {
  initialFieldState,
  stepField,
  type FieldEffect,
  type FieldEvent,
  type FieldState
} from '@shared/settings/field-state';
import type {ControlDescriptor} from '@shared/settings/panel-model';
import {isBoolean, isNumber, isObject, isString} from '@shared/types/guards';
import type {SettingsSnapshot, SettingsWriteOutcome, SettingTarget} from '@shared/settings/protocol';

import type {SettingsGateway} from './ports';

/** Every reason a field can show an error for. */
export type FieldErrorCode = CoercionFailure['reason'] | 'rejected' | 'failed';

/** One inline error, with the main process's text when it supplied one. */
export type FieldError = {
  readonly code: FieldErrorCode;
  readonly message?: string;
  readonly suggestedFix?: string;
  /** Present on a range failure so the message can name the bound. */
  readonly minimum?: number;
  readonly maximum?: number;
};

/** One editable field the store manages. */
export type FieldDefinition = {
  readonly id: string;
  readonly target: SettingTarget;
  readonly control: ControlDescriptor;
};

/** What the last completed write or reset did, for the live region. */
export type FieldStatus = 'idle' | 'invalid' | 'saving' | 'saved' | 'reset' | 'failed' | 'unconfirmed';

/** The immutable view of the field map components subscribe to. */
export type FieldStoreSnapshot = {
  readonly fields: ReadonlyMap<string, FieldState<SettingValue, FieldError>>;
  /**
   * The outcome of the most recent action. A fresh store reports `idle`, so a
   * screen reader is not told "saved" before anything was saved.
   */
  readonly status: FieldStatus;
  /**
   * The newest file snapshot the store has seen, including one carried by an
   * applied write. The panel uses it for changed markers and `@modified`
   * before the watcher's reload arrives.
   */
  readonly settingsSnapshot: SettingsSnapshot | null;
};

/** The store's public surface. */
export type FieldStore = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => FieldStoreSnapshot;
  readonly setDraft: (id: string, draft: string) => void;
  readonly submit: (id: string) => void;
  readonly revert: (id: string) => void;
  readonly reset: (id: string) => void;
  readonly refresh: (snapshot: SettingsSnapshot) => void;
  /** Resolves when no write is in flight and no outcome is pending. */
  readonly whenIdle: () => Promise<void>;
};

/** Dependencies of the field store. */
export type FieldStoreDependencies = {
  readonly gateway: SettingsGateway;
  readonly fields: readonly FieldDefinition[];
  /** Receives one bounded line per transport rejection; defaults to `console.error`. */
  readonly log?: (message: string) => void;
};

/**
 * Names a rejection by a fixed category and, when known, the error's name.
 *
 * A thrown error's message can repeat a path, a value, or a fragment of the
 * user's file, and it crosses from the main process, so it stays out of the
 * log. The category is always the same token; the name is added only when the
 * rejected value carries one as a string.
 *
 * @param error - Whatever the gateway's promise rejected with.
 * @returns The bounded category line, without the message.
 *
 * @example
 * ```ts
 * settingsRejectionLine(new TypeError('bad /home/ada'));
 * // 'settings write rejected category=transport name=TypeError'
 * settingsRejectionLine('nope'); // 'settings write rejected category=transport'
 * ```
 */
const settingsRejectionLine = (error: unknown): string => {
  const category = 'settings write rejected category=transport';
  const name = isObject(error) && 'name' in error && isString(error.name) ? error.name : undefined;
  return name === undefined ? category : `${category} name=${name}`;
};

const FALLBACK_ERROR: FieldError = {code: 'failed'};

type BoundsError = {code: FieldErrorCode; minimum?: number; maximum?: number};

const coercionErrors = (failure: CoercionFailure): readonly FieldError[] => {
  const error: BoundsError = {code: failure.reason};
  if (failure.minimum !== undefined) {
    error.minimum = failure.minimum;
  }
  if (failure.maximum !== undefined) {
    error.maximum = failure.maximum;
  }
  return [error];
};

const outcomeEvent = (requestId: number, outcome: SettingsWriteOutcome): FieldEvent<SettingValue, FieldError> => {
  switch (outcome.kind) {
    case 'applied': {
      return {kind: 'outcome', requestId, result: 'applied', errors: [], fallbackError: FALLBACK_ERROR};
    }
    case 'rejected': {
      return {
        kind: 'outcome',
        requestId,
        result: 'denied',
        errors: outcome.diagnostics.map((diagnostic) => ({
          code: 'rejected',
          message: diagnostic.message,
          suggestedFix: diagnostic.suggestedFix
        })),
        fallbackError: {code: 'rejected'}
      };
    }
    case 'failed': {
      return {
        kind: 'outcome',
        requestId,
        result: 'errored',
        errors: [outcome.detail === undefined ? {code: 'failed'} : {code: 'failed', message: outcome.detail}],
        fallbackError: FALLBACK_ERROR
      };
    }
  }
};

const isScalarValue = (value: unknown): value is SettingValue => {
  if (isString(value)) {
    return true;
  }
  if (isNumber(value)) {
    return true;
  }
  return isBoolean(value);
};

const committedValueOf = (snapshot: SettingsSnapshot, target: SettingTarget): SettingValue | undefined => {
  const stored = snapshot.userValues[target.key];
  if (isScalarValue(stored)) {
    return stored;
  }
  // An unset key displays its effective default. File presence is tracked
  // separately, so the row can still say the value is not customised.
  const fallback = snapshot.defaultValues[target.key];
  return isScalarValue(fallback) ? fallback : undefined;
};

/**
 * Creates a field store.
 *
 * @param dependencies - The gateway and the fields to manage.
 * @returns The store.
 *
 * @example
 * const store = createFieldStore({gateway, fields});
 * store.setDraft('core:fontSize', '16');
 * store.submit('core:fontSize');
 */
export const createFieldStore = ({
  gateway,
  fields,
  log = (message) => console.error(message)
}: FieldStoreDependencies): FieldStore => {
  const definitions = new Map(fields.map((field) => [field.id, field]));
  let states = new Map<string, FieldState<SettingValue, FieldError>>(
    fields.map((field) => [field.id, initialFieldState<SettingValue, FieldError>(undefined, '')])
  );
  let status: FieldStatus = 'idle';
  let snapshot: FieldStoreSnapshot = {fields: states, status, settingsSnapshot: null};
  const listeners = new Set<() => void>();
  let inFlight = 0;
  let lastRevision = -1;
  let latestSnapshot: SettingsSnapshot | null = null;
  let idleWaiters: (() => void)[] = [];

  const publish = (): void => {
    snapshot = {fields: new Map(states), status, settingsSnapshot: latestSnapshot};
    for (const listener of listeners) {
      listener();
    }
  };

  const settle = (): void => {
    inFlight -= 1;
    if (inFlight === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) {
        resolve();
      }
    }
  };

  const apply = (
    definition: FieldDefinition,
    event: FieldEvent<SettingValue, FieldError>
  ): FieldEffect<SettingValue> => {
    const state = states.get(definition.id);
    if (state === undefined) {
      return {kind: 'none', requestId: -1};
    }
    const result = stepField(state, event);
    states = new Map(states).set(definition.id, result.state);
    publish();
    return result.effect;
  };

  /** Records an answer that arrived while its request was still current. */
  const recordOutcomeStatus = (
    definition: FieldDefinition,
    effect: FieldEffect<SettingValue>,
    outcome: SettingsWriteOutcome
  ): void => {
    if (states.get(definition.id)?.pendingRequestId !== effect.requestId) {
      return;
    }
    if (outcome.kind !== 'applied') {
      status = 'failed';
      return;
    }
    if (outcome.durability === 'unconfirmed') {
      status = 'unconfirmed';
      return;
    }
    status = effect.kind === 'reset' ? 'reset' : 'saved';
  };

  /** Applies one answer from the gateway. */
  const settleOutcome = (
    definition: FieldDefinition,
    effect: FieldEffect<SettingValue>,
    outcome: SettingsWriteOutcome
  ): void => {
    recordOutcomeStatus(definition, effect, outcome);
    apply(definition, outcomeEvent(effect.requestId, outcome));
    if (outcome.kind !== 'applied') {
      return;
    }
    if (outcome.snapshot.revision >= lastRevision) {
      refresh(outcome.snapshot);
      return;
    }
    // A newer snapshot (an external reload, say) was already applied while this
    // write was pending. Settling the field made it clean, so reconcile its
    // committed value and draft with that newest snapshot rather than leaving
    // the older write's value on screen.
    if (latestSnapshot !== null) {
      refresh(latestSnapshot);
    }
  };

  /** Applies a transport failure to the field, unless a newer request owns it. */
  const failOutcome = (definition: FieldDefinition, effect: FieldEffect<SettingValue>): void => {
    if (states.get(definition.id)?.pendingRequestId === effect.requestId) {
      status = 'failed';
    }
    apply(definition, outcomeEvent(effect.requestId, {kind: 'failed', reason: 'io-error'}));
  };

  const runEffect = (definition: FieldDefinition, effect: FieldEffect<SettingValue>): void => {
    if (effect.kind === 'none') {
      return;
    }
    inFlight += 1;
    status = 'saving';
    publish();
    const request =
      effect.kind === 'write'
        ? gateway.setValue(definition.target, effect.value)
        : gateway.resetValue(definition.target);
    void request
      .then((outcome) => {
        settleOutcome(definition, effect, outcome);
      })
      .catch((error: unknown) => {
        // The outcome still reports the failure to the field; this line is the
        // only evidence a session log can carry, so it stays bounded.
        log(settingsRejectionLine(error));
        failOutcome(definition, effect);
      })
      .finally(settle);
  };

  const refresh = (next: SettingsSnapshot): void => {
    if (next.revision < lastRevision) {
      return;
    }
    lastRevision = next.revision;
    latestSnapshot = next;
    for (const field of fields) {
      const committed = committedValueOf(next, field.target);
      apply(field, {kind: 'refresh', committed, draft: formatValue(field.control, committed)});
    }
  };

  const commit = (definition: FieldDefinition): void => {
    const state = states.get(definition.id);
    if (state === undefined) {
      return;
    }
    const coercion = coerceInput(definition.control, state.draft);
    if (!coercion.ok) {
      // A locally refused value never reaches the main process, so the polite
      // live region has to hear about it from here.
      status = 'invalid';
      const event: FieldEvent<SettingValue, FieldError> = {
        kind: 'submit',
        submission: {kind: 'uncoerced', errors: coercionErrors(coercion.failure)},
        fallbackError: FALLBACK_ERROR
      };
      apply(definition, event);
      return;
    }
    const event: FieldEvent<SettingValue, FieldError> = {
      kind: 'submit',
      submission: {kind: 'coerced', value: coercion.value},
      fallbackError: FALLBACK_ERROR
    };
    runEffect(definition, apply(definition, event));
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setDraft: (id, draft) => {
      const definition = definitions.get(id);
      if (definition !== undefined) {
        if (status !== 'idle') {
          status = 'idle';
          publish();
        }
        apply(definition, {kind: 'edit', draft});
      }
    },
    submit: (id) => {
      const definition = definitions.get(id);
      if (definition !== undefined) {
        commit(definition);
      }
    },
    revert: (id) => {
      const definition = definitions.get(id);
      const state = states.get(id);
      if (definition !== undefined && state !== undefined) {
        apply(definition, {kind: 'revert', draft: formatValue(definition.control, state.committed)});
      }
    },
    reset: (id) => {
      const definition = definitions.get(id);
      if (definition !== undefined) {
        runEffect(definition, apply(definition, {kind: 'reset'}));
      }
    },
    refresh,
    whenIdle: () => (inFlight === 0 ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve)))
  };
};
