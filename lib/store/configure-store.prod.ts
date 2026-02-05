/**
 * @file Configures and exports the Redux store for production builds.
 *
 * Responsibilities:
 * - Create the store with `createStore` and `applyMiddleware`.
 * - Include thunk support through `thunk` and `ThunkMiddleware`.
 *
 * Usage:
 * - Use in production runtime paths where Redux DevTools are not required.
 */
import {createStore, applyMiddleware} from 'redux';
import thunk from 'redux-thunk';
import type {ThunkMiddleware} from 'redux-thunk';

import type {HyperState, HyperActions} from '../../typings/hyper';
import rootReducer from '../reducers/index';
import effects from '../utils/effects';
import * as plugins from '../utils/plugins';

import writeMiddleware from './write-middleware';

const thunkMiddleware: ThunkMiddleware<HyperState, HyperActions> = thunk as ThunkMiddleware<HyperState, HyperActions>;

const configureStoreForProd = () =>
  createStore(rootReducer, undefined, applyMiddleware(thunkMiddleware, plugins.middleware, writeMiddleware, effects));

export default configureStoreForProd;
