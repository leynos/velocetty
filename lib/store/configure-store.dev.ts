import {composeWithDevTools} from '@redux-devtools/extension';
import {createStore, applyMiddleware} from 'redux';
import {thunk} from 'redux-thunk';
import type {ThunkMiddleware} from 'redux-thunk';

import type {HyperState, HyperActions} from '../../typings/hyper';
import rootReducer from '../reducers/index';
import effects from '../utils/effects';
import * as plugins from '../utils/plugins';

import writeMiddleware from './write-middleware';

const thunkMiddleware: ThunkMiddleware<HyperState, HyperActions> = thunk as ThunkMiddleware<HyperState, HyperActions>;

const configureStoreForDevelopment = () => {
  const enhancer = composeWithDevTools(
    applyMiddleware(thunkMiddleware, plugins.middleware, thunkMiddleware, writeMiddleware, effects)
  );

  return createStore(rootReducer, undefined, enhancer);
};

export default configureStoreForDevelopment;
