/**
 * @file Exports the root Redux reducer assembled with `combineReducers`.
 *
 * Responsibilities:
 * - Compose the `ui`, `sessions`, and `termGroups` reducers.
 * - Provide a typed root reducer using `Reducer` and `ReducersMapObject`.
 *
 * Usage:
 * - Import as the application root reducer when creating the Redux store.
 */
import {combineReducers} from 'redux';
import type {ReducersMapObject} from 'redux';

import type {HyperActions, HyperState} from '../../typings/hyper';

import sessions from './sessions';
import termGroups from './term-groups';
import ui from './ui';

const reducers: ReducersMapObject<HyperState, HyperActions> = {
  ui,
  sessions,
  termGroups
};

const rootReducer = combineReducers(reducers);

export default rootReducer;
