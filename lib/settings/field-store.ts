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
import {isBoolean, isNumber, isString} from '@shared/types/guards';
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

/** The immutable view of the field map components subscribe to. */
export type FieldStoreSnapshot = {
  readonly fields: ReadonlyMap<string, FieldState<SettingValue, FieldError>>;
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
export const createFieldStore = ({gateway, fields}: FieldStoreDependencies): FieldStore => {
  const definitions = new Map(fields.map((field) => [field.id, field]));
  let states = new Map<string, FieldState<SettingValue, FieldError>>(
    fields.map((field) => [field.id, initialFieldState<SettingValue, FieldError>(undefined, '')])
  );
  let snapshot: FieldStoreSnapshot = {fields: states};
  const listeners = new Set<() => void>();
  let inFlight = 0;
  let lastRevision = -1;
  let idleWaiters: (() => void)[] = [];

  const publish = (): void => {
    snapshot = {fields: new Map(states)};
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

  const runEffect = (definition: FieldDefinition, effect: FieldEffect<SettingValue>): void => {
    if (effect.kind === 'none') {
      return;
    }
    inFlight += 1;
    const request =
      effect.kind === 'write'
        ? gateway.setValue(definition.target, effect.value)
        : gateway.resetValue(definition.target);
    void request
      .then((outcome) => {
        // An answer for a superseded request must not refresh the snapshot:
        // a newer submission already owns the display.
        const isCurrent = states.get(definition.id)?.pendingRequestId === effect.requestId;
        apply(definition, outcomeEvent(effect.requestId, outcome));
        if (outcome.kind === 'applied' && isCurrent) {
          // Applying the outcome also refreshes every field's committed value,
          // so a reset that removed one key updates the others' modified flags.
          refresh(outcome.snapshot);
        }
      })
      .catch(() => {
        apply(definition, outcomeEvent(effect.requestId, {kind: 'failed', reason: 'io-error'}));
      })
      .finally(settle);
  };

  const refresh = (next: SettingsSnapshot): void => {
    if (next.revision < lastRevision) {
      return;
    }
    lastRevision = next.revision;
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
    const event: FieldEvent<SettingValue, FieldError> = coercion.ok
      ? {kind: 'submit', submission: {kind: 'coerced', value: coercion.value}, fallbackError: FALLBACK_ERROR}
      : {
          kind: 'submit',
          submission: {kind: 'uncoerced', errors: coercionErrors(coercion.failure)},
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
