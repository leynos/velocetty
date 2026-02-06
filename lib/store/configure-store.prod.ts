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
import {thunk} from 'redux-thunk';

import rootReducer from '../reducers/index';
import effects from '../utils/effects';
import * as plugins from '../utils/plugins';

import writeMiddleware from './write-middleware';

const configureStoreForProd = () =>
  createStore(rootReducer, undefined, applyMiddleware(thunk, plugins.middleware, writeMiddleware, effects));

export default configureStoreForProd;
