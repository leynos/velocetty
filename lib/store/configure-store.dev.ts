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
import {thunk} from 'redux-thunk';

import rootReducer from '../reducers/index';
import effects from '../utils/effects';
import * as plugins from '../utils/plugins';

import writeMiddleware from './write-middleware';

/** Build the development store with logging and hot-reload support. */
const configureStoreForDevelopment = () => {
  const enhancer = composeWithDevTools(applyMiddleware(thunk, plugins.middleware, writeMiddleware, effects));

  return createStore(rootReducer, undefined, enhancer);
};

/** Creates the development Redux store with thunk, plugin, write, and effects middleware, plus DevTools. */
/** Build the development store with logging and hot-reload support. */
export default configureStoreForDevelopment;
