/** @file Covers deterministic tab-decoration provider ordering and update events. */
import {describe, expect, test} from 'bun:test';

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
});
