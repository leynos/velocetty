/**
 * @file Covers the plugin command facade.
 *
 * A plugin runs in the same process as the renderer, so it can hand the
 * dispatcher a function, a class instance, or a cyclic object. None of those
 * survive the wire, and a JSON Schema validator would accept some of them as
 * objects. The facade therefore checks the payload is JSON before admission.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/plugin-api.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/inbound/plugin-api.ts`
 */
import {describe, expect, test} from 'bun:test';

import {asCommandId, type CommandInvocation} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import {createCommandDispatcher} from '../../../lib/command-dispatch/dispatcher';
import {createPluginCommandApi, unavailablePluginCommandApi} from '../../../lib/command-dispatch/inbound/plugin-api';
import type {RendererExecutionContext} from '../../../lib/command-dispatch/adapters/renderer-executor';
import {createDispatcherFakes, fakeDefinition} from '../../testUtils/command-dispatcher-fakes';

const COMMAND = 'test:plugin:command';

const buildDispatcher = () => {
  const fakes = createDispatcherFakes<RendererExecutionContext>({
    commands: {
      [COMMAND]: {definition: fakeDefinition(COMMAND, {argsSchema: {type: ['object', 'null']}}), handlerValue: null}
    }
  });
  return {fakes, dispatcher: createCommandDispatcher(fakes.ports)};
};

describe('the plugin facade', () => {
  test('fixes the invocation source to plugin', async () => {
    const {fakes, dispatcher} = buildDispatcher();
    const api = createPluginCommandApi(dispatcher);

    await api(COMMAND, {uid: 's1'});

    const admission: CommandInvocation | undefined = fakes.gateAdmissions[0]?.invocation;
    expect(admission?.source).toBe('plugin');
    expect(fakes.handlerCalls[0]?.context).toEqual({triggerEvent: undefined});
  });

  test.each([
    {description: 'a function', value: () => {}},
    {description: 'an array containing a function', value: [1, () => {}]},
    {description: 'a class instance', value: new (class Widget {})()},
    {description: 'a bigint', value: 1n}
  ])('rejects $description before admission', async ({value}) => {
    const {fakes, dispatcher} = buildDispatcher();
    const api = createPluginCommandApi(dispatcher);

    // SAFETY: each generated value is deliberately outside `JsonValue`; that is
    // the input under test, and the facade must reject it at runtime.
    const result = await api(COMMAND, value as never);

    expect(result).toMatchObject({status: 'error', error: {code: 'INVALID_COMMAND_ARGS'}});
    expect(fakes.gateAdmissions).toHaveLength(0);
    expect(fakes.handlerCalls).toHaveLength(0);
  });

  test('normalizes absent arguments to null', async () => {
    const {fakes, dispatcher} = buildDispatcher();
    const api = createPluginCommandApi(dispatcher);

    await api(COMMAND);

    expect(fakes.gateAdmissions[0]?.args).toBeNull();
  });

  test('passes a caller signal through', async () => {
    const {fakes, dispatcher} = buildDispatcher();
    const api = createPluginCommandApi(dispatcher);
    const controller = new AbortController();

    const pending = api(COMMAND, null, {signal: controller.signal});
    expect(fakes.handlerCalls[0]?.signal).toBe(controller.signal);

    controller.abort();
    expect(await pending).toEqual({status: 'cancelled', stage: 'during-execution'});
  });

  test('never rejects, even for a rejected argument', async () => {
    const {dispatcher} = buildDispatcher();
    const api = createPluginCommandApi(dispatcher);

    // SAFETY: a bigint is deliberately outside `JsonValue`; that is the value
    // under test, and the facade must reject it rather than fail to compile.
    // SAFETY: as above — a bigint is outside `JsonValue` by construction.
    await expect(api(COMMAND, 1n as never)).resolves.toBeDefined();
  });
});

describe('the unavailable facade', () => {
  test('reports a structured failure rather than throwing', async () => {
    await expect(unavailablePluginCommandApi(asCommandId(COMMAND))).resolves.toMatchObject({
      status: 'error',
      error: {code: 'COMMAND_EXECUTION_FAILED', commandId: asCommandId(COMMAND)}
    });
  });
});
