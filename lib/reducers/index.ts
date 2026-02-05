import {combineReducers} from 'redux';
import type {Reducer, ReducersMapObject} from 'redux';

import type {HyperActions, HyperState} from '../../typings/hyper';

import sessions from './sessions';
import termGroups from './term-groups';
import ui from './ui';

const reducers: ReducersMapObject<HyperState, HyperActions> = {
  ui,
  sessions,
  termGroups
};

const rootReducer = combineReducers(reducers) as Reducer<HyperState, HyperActions, Partial<HyperState>>;

export default rootReducer;
