/**
 * @file The settings container's real state and dispatch mappings.
 *
 * Rendering the connected container needs the whole Redux, plugin, and
 * transport graph, so these tests call the mappers the container exports. They
 * fail if a handler stops dispatching, dispatches the wrong action, or reads a
 * different slice of the store, which a component-only test would not see.
 */
import {beforeEach, expect, mock, test} from 'bun:test';

import type {HyperState} from '../../typings/hyper';
import {SETTINGS_CATEGORY_SELECT, SETTINGS_QUERY_SET} from '@shared/constants/settings-tab';
import {asCommandId} from '@shared/types/commands';
import {createTransportMock} from '../testUtils/transport-mock';
import {registerModuleMock} from '../testUtils/mock-module';
import {importFresh} from '../testUtils/import-fresh';

const {transportMock} = createTransportMock();

type ContainerModule = typeof import('../../lib/containers/settings');

let container: ContainerModule;

beforeEach(async () => {
  mock.restore();
  registerModuleMock('../../lib/transport', () => ({transport: transportMock}));
  registerModuleMock('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));
  container = await importFresh<ContainerModule>('../../lib/containers/settings', 'settings_container_wiring');
});

const dispatchSpy = () => mock((_action: unknown) => {});

test('the state mapping reads the settings slice', () => {
  // SAFETY: `mapStateToProps` reads only `settingsTab`, so the rest of the
  // store shape is irrelevant to this call.
  const state = {
    settingsTab: {query: 'font', selectedCategory: 'appearance', isActive: true}
  } as HyperState;

  expect(container.mapStateToProps(state)).toEqual({
    query: 'font',
    selectedCategory: 'appearance',
    isActive: true
  });
});

test('each handler dispatches the action the reducer expects', () => {
  const dispatch = dispatchSpy();
  // SAFETY: the mapper only calls `dispatch` with the actions asserted below.
  const props = container.mapDispatchToProps(dispatch as never);

  props.onQueryChange('font');
  props.onCategorySelect('appearance');
  props.onClearFilters();

  expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
    {type: SETTINGS_QUERY_SET, query: 'font'},
    {type: SETTINGS_CATEGORY_SELECT, category: 'appearance'},
    {type: SETTINGS_QUERY_SET, query: ''},
    {type: SETTINGS_CATEGORY_SELECT, category: 'all'}
  ]);
});

test('opening the config file asks the main process for it', () => {
  // SAFETY: opening the file never calls `dispatch`, so the stub's action type
  // is irrelevant.
  const props = container.mapDispatchToProps(dispatchSpy() as never);

  props.onOpenConfigFile();

  expect(transportMock.emit.mock.calls).toEqual([['command', asCommandId('window:openConfigFile')]]);
});
