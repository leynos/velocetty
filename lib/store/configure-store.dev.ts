/**
 * @file Configures and exports the Redux store for development builds.
 *
 * Responsibilities:
 * - Create the store with `createStore`.
 * - Compose middleware via `applyMiddleware` and `composeWithDevTools`.
 *
 * Usage:
 * - Use in development runtime paths where Redux DevTools integration is
 *   required.
 */
import {composeWithDevTools} from '@redux-devtools/extension';
import {createStore, applyMiddleware} from 'redux';
import thunk from 'redux-thunk';
import type {ThunkMiddleware} from 'redux-thunk';

import type {HyperState, HyperActions} from '../../typings/hyper';
import rootReducer from '../reducers/index';
import effects from '../utils/effects';
import * as plugins from '../utils/plugins';

import writeMiddleware from './write-middleware';

const thunkMiddleware: ThunkMiddleware<HyperState, HyperActions> = thunk as ThunkMiddleware<HyperState, HyperActions>;

const configureStoreForDevelopment = () => {
  const enhancer = composeWithDevTools(applyMiddleware(thunkMiddleware, plugins.middleware, writeMiddleware, effects));

  return createStore(rootReducer, undefined, enhancer);
};

export default configureStoreForDevelopment;
