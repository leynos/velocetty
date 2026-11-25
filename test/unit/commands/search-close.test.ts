/**
 * @file Covers the built-in `editor:search-close` command contract.
 *
 * This is the regression guard for the Escape key. Escape binds
 * `editor:search-close` with no arguments, so the command's schema must admit
 * `null`: a schema that demanded an object would reject every Escape press, and
 * the key would stop reaching the terminal.
 *
 * Responsibilities:
 * - pin the argument schema's admitted and rejected shapes
 * - check that the uid extractor agrees with the schema
 * - check that the handler closes the requested session and releases the key
 *   when there is nothing to close
 *
 * Invariants:
 * - the schema and `searchCloseUid` never disagree about a value the schema
 *   admits
 * - no test mutates the module-level schema object
 *
 * Usage:
 * - `bun test --isolate test/unit/commands/search-close.test.ts`
 *
 * Related modules:
 * - `../../../lib/commands/search-close.ts`
 */
import {expect, mock, test} from 'bun:test';

import {asProfileId, asSessionId} from '@shared/types/common';
import {SESSION_ADD, SESSION_SEARCH} from '@shared/constants/sessions';
import {asCommandId, type CommandDefinition, type CommandValidationResult} from '@shared/types/commands';
import {
  closeSearchAction,
  createSearchCloseHandler,
  SEARCH_CLOSE_ARGS_SCHEMA,
  searchCloseUid
} from '../../../lib/commands/search-close';
import {createCommandSchemaValidator} from '../../../lib/command-registry-validation';
import rootReducer from '../../../lib/reducers';
import type {HyperDispatch, HyperState} from '../../../typings/hyper';

const SEARCH_CLOSE_DEFINITION: CommandDefinition = {
  id: asCommandId('editor:search-close'),
  kind: 'frontend',
  metadata: {title: 'Close Search'},
  argsSchema: SEARCH_CLOSE_ARGS_SCHEMA
};

const createValidator = () => createCommandSchemaValidator({getDefinition: () => SEARCH_CLOSE_DEFINITION});

const validate = (args: unknown): CommandValidationResult =>
  createValidator().validateArgs('editor:search-close', args);

type SearchCloseThunk = (dispatch: HyperDispatch, getState: () => HyperState) => void;

const isSearchCloseThunk = (value: unknown): value is SearchCloseThunk => typeof value === 'function';

/**
 * Runs the thunk a handler dispatched, against a state with the given search
 * flag, and hands back the inner dispatch it used.
 */
const runDispatchedThunk = (dispatch: ReturnType<typeof mock<HyperDispatch>>, isSearching: boolean) => {
  const innerDispatch = mock<HyperDispatch>(() => {});
  const dispatchedThunk = dispatch.mock.calls[0]?.[0];
  if (!isSearchCloseThunk(dispatchedThunk)) {
    throw new TypeError('Expected the search-close handler to dispatch a thunk');
  }
  dispatchedThunk(innerDispatch, () => createSearchState(isSearching, 'requested-session'));
  return innerDispatch;
};

const createSearchState = (isSearching: boolean, sessionUid = 'active-session'): HyperState => {
  const uid = asSessionId(sessionUid);
  const withSession = rootReducer(undefined, {
    type: SESSION_ADD,
    uid,
    shell: null,
    pid: null,
    cols: 80,
    rows: 24,
    activeUid: uid,
    now: 0,
    profile: asProfileId('default')
  });

  return isSearching ? rootReducer(withSession, {type: SESSION_SEARCH, uid, value: true}) : withSession;
};

test('the argument schema admits null, which is how Escape arrives', () => {
  expect(validate(null)).toMatchObject({ok: true});
});

test('the argument schema admits an explicit session uid', () => {
  expect(validate({uid: 's1'})).toMatchObject({ok: true});
});

test('the argument schema rejects a non-string uid and extra properties', () => {
  for (const args of [{uid: 42}, {uid: ''}, {uid: 's1', extra: true}, 's1', 7]) {
    const result = validate(args);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(`Expected ${JSON.stringify(args)} to be rejected`);
    }
    expect(result.error.code).toBe('INVALID_COMMAND_ARGS');
  }
});

test('searchCloseUid agrees with the schema about every admitted shape', () => {
  // Every admitted value maps to a uid the handler can act on: `null` and `{}`
  // both mean "the active session", and `{uid}` names one.
  const admittedCases: {args: unknown; expectedUid: string | undefined}[] = [
    {args: null, expectedUid: undefined},
    {args: {}, expectedUid: undefined},
    {args: {uid: 's1'}, expectedUid: 's1'}
  ];

  for (const {args, expectedUid} of admittedCases) {
    expect(validate(args)).toMatchObject({ok: true});
    expect(searchCloseUid(args)).toBe(expectedUid);
  }

  // Everything the schema rejects also fails to name a session, so a handler
  // reached with such a value falls back to the active session rather than
  // acting on a malformed payload.
  for (const args of [{uid: 42}, 's1', 7, []]) {
    expect(validate(args).ok).toBe(false);
    expect(searchCloseUid(args)).toBeUndefined();
  }
});

test('the handler closes the requested session and restores terminal focus', () => {
  const focusActiveTerm = mock(() => {});
  const handler = createSearchCloseHandler({closeSearch: closeSearchAction, focusActiveTerm});
  const dispatch = mock<HyperDispatch>(() => {});

  handler(undefined, dispatch);

  const innerDispatch = runDispatchedThunk(dispatch, true);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(innerDispatch).toHaveBeenCalledWith(
    expect.objectContaining({type: SESSION_SEARCH, uid: 'requested-session', value: false})
  );
  expect(focusActiveTerm).toHaveBeenCalledTimes(1);
});

test('the handler releases the key when no search box is open', () => {
  const focusActiveTerm = mock(() => {});
  const handler = createSearchCloseHandler({closeSearch: closeSearchAction, focusActiveTerm});

  const dispatch = mock<HyperDispatch>(() => {});
  const keyEvent = {catched: true};

  handler(keyEvent, dispatch);

  const innerDispatch = runDispatchedThunk(dispatch, false);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(innerDispatch).not.toHaveBeenCalled();
  expect(keyEvent.catched).toBe(false);
});
