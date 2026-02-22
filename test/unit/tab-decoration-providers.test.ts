/** @file Covers deterministic tab-decoration provider ordering and update events. */
import {describe, expect, mock, test} from 'bun:test';

import {TabDecorationProviderRegistry} from '../../lib/utils/tab-decoration-providers';

const buildContext = () => ({
  tabId: 'tab-1',
  tabIndex: 0,
  active: true,
  hasActivity: false,
  title: 'Shell'
});

describe('TabDecorationProviderRegistry', () => {
  test('orders providers by priority then lexicographic id', () => {
    const registry = new TabDecorationProviderRegistry();

    registry.register({
      id: 'zeta',
      priority: 10,
      provideDecoration: () => ({title: 'zeta'})
    });
    registry.register({
      id: 'alpha',
      priority: 10,
      provideDecoration: () => ({title: 'alpha'})
    });
    registry.register({
      id: 'middle',
      priority: 20,
      provideDecoration: () => ({title: 'middle'})
    });

    const providerIds = registry.listProviders().map((provider) => provider.id);
    expect(providerIds).toEqual(['middle', 'alpha', 'zeta']);
  });

  test('uses deterministic singleton tie-breaks and bounded list merges', () => {
    const registry = new TabDecorationProviderRegistry();

    registry.register({
      id: 'beta',
      priority: 20,
      provideDecoration: () => ({
        title: 'beta-title',
        badges: [{text: 'beta-1'}, {text: 'beta-2'}, {text: 'beta-2'}],
        widgets: [
          {icon: 'zap', command: 'workbench.action.one'},
          {icon: 'zap', command: 'workbench.action.one'},
          {icon: 'bolt', command: 'workbench.action.two'}
        ]
      })
    });
    registry.register({
      id: 'alpha',
      priority: 20,
      provideDecoration: () => ({
        title: 'alpha-title',
        badges: [{text: 'alpha-1'}, {text: 'alpha-2'}],
        widgets: [{icon: 'rocket', command: 'workbench.action.three'}]
      })
    });

    const decoration = registry.resolve(buildContext());

    // Equal priorities prefer lexicographically smaller ids.
    expect(decoration.title).toBe('alpha-title');
    // Badge output is deduplicated and capped to three entries.
    expect(decoration.badges).toEqual([{text: 'alpha-1'}, {text: 'alpha-2'}, {text: 'beta-1'}]);
    // Widget output is deduplicated and capped to two entries.
    expect(decoration.widgets).toEqual([
      {icon: 'rocket', command: 'workbench.action.three'},
      {icon: 'zap', command: 'workbench.action.one'}
    ]);
  });

  test('does not collide dedupe keys when values contain delimiters', () => {
    const registry = new TabDecorationProviderRegistry();

    registry.register({
      id: 'delimiter-provider',
      priority: 1,
      provideDecoration: () => ({
        badges: [
          {icon: 'a:b', text: 'c'},
          {icon: 'a', text: 'b:c'}
        ],
        widgets: [
          {icon: 'alpha:beta', command: 'workbench.action.one'},
          {icon: 'alpha', command: 'beta:workbench.action.one'}
        ]
      })
    });

    const decoration = registry.resolve(buildContext());
    expect(decoration.badges).toEqual([
      {icon: 'a:b', text: 'c'},
      {icon: 'a', text: 'b:c'}
    ]);
    expect(decoration.widgets).toEqual([
      {icon: 'alpha:beta', command: 'workbench.action.one'},
      {icon: 'alpha', command: 'beta:workbench.action.one'}
    ]);
  });

  test('emits updates only from explicit provider-change events', async () => {
    const registry = new TabDecorationProviderRegistry();
    const updateReasons: string[] = [];
    let emitProviderChange: (() => void) | null = null;

    registry.subscribe(() => {
      updateReasons.push('changed');
    });

    const unregister = registry.register({
      id: 'provider',
      priority: 1,
      provideDecoration: () => ({title: 'stable'}),
      subscribe: (onDidChange) => {
        emitProviderChange = onDidChange;
      }
    });

    // Registration emits one explicit change event.
    expect(updateReasons).toHaveLength(1);

    await Bun.sleep(10);
    // No polling should fire additional events without provider callbacks.
    expect(updateReasons).toHaveLength(1);

    emitProviderChange?.();
    expect(updateReasons).toHaveLength(2);

    unregister();
    expect(updateReasons).toHaveLength(3);
  });

  test('clear disposes provider subscriptions and emits one change event', () => {
    const registry = new TabDecorationProviderRegistry();
    const updateListener = mock(() => {});
    const disposeProvider = mock(() => {});

    registry.subscribe(updateListener);
    registry.register({
      id: 'subscribed-provider',
      priority: 1,
      provideDecoration: () => ({title: 'one'}),
      subscribe: () => disposeProvider
    });
    registry.register({
      id: 'plain-provider',
      priority: 1,
      provideDecoration: () => ({title: 'two'})
    });

    const updatesBeforeClear = updateListener.mock.calls.length;
    registry.clear();

    expect(disposeProvider).toHaveBeenCalledTimes(1);
    expect(registry.listProviders()).toHaveLength(0);
    expect(updateListener.mock.calls.length).toBe(updatesBeforeClear + 1);
  });

  test('resolve continues when one provider throws', () => {
    const registry = new TabDecorationProviderRegistry();

    registry.register({
      id: 'failing-provider',
      priority: 10,
      provideDecoration: () => {
        throw new Error('boom');
      }
    });
    registry.register({
      id: 'healthy-provider',
      priority: 5,
      provideDecoration: () => ({title: 'healthy'})
    });

    const resolved = registry.resolve(buildContext());
    expect(resolved.title).toBe('healthy');
  });

  test.each([
    {
      description: 'empty ids',
      invalidId: '   ' as string
    },
    {
      description: 'non-string ids',
      invalidId: 123 as unknown as string
    }
  ])('ignores provider registrations with $description', ({invalidId}) => {
    const registry = new TabDecorationProviderRegistry();

    const unregister = registry.register({
      id: invalidId,
      priority: 1,
      provideDecoration: () => ({title: 'ignored'})
    });

    expect(typeof unregister).toBe('function');
    expect(registry.listProviders()).toEqual([]);
  });
});
