/** @file Covers deterministic tab-decoration provider ordering and update events. */
import {beforeEach, describe, expect, mock, test} from 'bun:test';

import {asCommandId} from '@shared/types/commands';
import {
  asTabDecorationProviderId,
  asTabId,
  TabDecorationProviderRegistry
} from '../../lib/utils/tab-decoration-providers';

/** Silent logger that prevents expected warning noise from polluting test output. */
const silentLogger = {warn: () => {}, error: () => {}};

/** Holds the callback a provider publishes from inside `subscribe`. */
type ProviderChangeSink = {emit?: () => void};

const buildContext = () => ({
  tabId: asTabId('tab-1'),
  tabIndex: 0,
  active: true,
  hasActivity: false,
  title: 'Shell'
});

describe('TabDecorationProviderRegistry', () => {
  let registry: TabDecorationProviderRegistry;

  beforeEach(() => {
    registry = new TabDecorationProviderRegistry();
  });

  test('orders providers by priority then lexicographic id', () => {
    registry.register({
      id: asTabDecorationProviderId('zeta'),
      priority: 10,
      provideDecoration: () => ({title: 'zeta'})
    });
    registry.register({
      id: asTabDecorationProviderId('alpha'),
      priority: 10,
      provideDecoration: () => ({title: 'alpha'})
    });
    registry.register({
      id: asTabDecorationProviderId('middle'),
      priority: 20,
      provideDecoration: () => ({title: 'middle'})
    });

    const providerIds = registry.listProviders().map((provider) => provider.id);
    expect(providerIds).toEqual([
      asTabDecorationProviderId('middle'),
      asTabDecorationProviderId('alpha'),
      asTabDecorationProviderId('zeta')
    ]);
  });

  test('uses deterministic singleton tie-breaks and bounded list merges', () => {
    registry.register({
      id: asTabDecorationProviderId('beta'),
      priority: 20,
      provideDecoration: () => ({
        title: 'beta-title',
        badges: [{text: 'beta-1'}, {text: 'beta-2'}, {text: 'beta-2'}],
        widgets: [
          {icon: 'zap', command: asCommandId('workbench.action.one')},
          {icon: 'zap', command: asCommandId('workbench.action.one')},
          {icon: 'bolt', command: asCommandId('workbench.action.two')}
        ]
      })
    });
    registry.register({
      id: asTabDecorationProviderId('alpha'),
      priority: 20,
      provideDecoration: () => ({
        title: 'alpha-title',
        badges: [{text: 'alpha-1'}, {text: 'alpha-2'}],
        widgets: [{icon: 'rocket', command: asCommandId('workbench.action.three')}]
      })
    });

    const decoration = registry.resolve(buildContext());

    // Equal priorities prefer lexicographically smaller ids.
    expect(decoration.title).toBe('alpha-title');
    // Badge output is deduplicated and capped to three entries.
    expect(decoration.badges).toEqual([{text: 'alpha-1'}, {text: 'alpha-2'}, {text: 'beta-1'}]);
    // Widget output is deduplicated and capped to two entries.
    expect(decoration.widgets).toEqual([
      {icon: 'rocket', command: asCommandId('workbench.action.three')},
      {icon: 'zap', command: asCommandId('workbench.action.one')}
    ]);
  });

  test('does not collide dedupe keys when values contain delimiters', () => {
    registry.register({
      id: asTabDecorationProviderId('delimiter-provider'),
      priority: 1,
      provideDecoration: () => ({
        badges: [
          {icon: 'a:b', text: 'c'},
          {icon: 'a', text: 'b:c'}
        ],
        widgets: [
          {icon: 'alpha:beta', command: asCommandId('workbench.action.one')},
          {icon: 'alpha', command: asCommandId('beta:workbench.action.one')}
        ]
      })
    });

    const decoration = registry.resolve(buildContext());
    expect(decoration.badges).toEqual([
      {icon: 'a:b', text: 'c'},
      {icon: 'a', text: 'b:c'}
    ]);
    expect(decoration.widgets).toEqual([
      {icon: 'alpha:beta', command: asCommandId('workbench.action.one')},
      {icon: 'alpha', command: asCommandId('beta:workbench.action.one')}
    ]);
  });

  test('emits updates only from explicit provider-change events', async () => {
    const updateReasons: string[] = [];
    // Held on an object rather than in a `let`: the provider only publishes the
    // callback from inside `subscribe`, which control-flow analysis does not
    // follow, so a local would stay narrowed to `null` at the call below.
    const providerChange: ProviderChangeSink = {};

    registry.subscribe(() => {
      updateReasons.push('changed');
    });

    const unregister = registry.register({
      id: asTabDecorationProviderId('provider'),
      priority: 1,
      provideDecoration: () => ({title: 'stable'}),
      subscribe: (onDidChange: () => void) => {
        providerChange.emit = onDidChange;
      }
    });

    // Registration emits one explicit change event.
    expect(updateReasons).toHaveLength(1);

    await Bun.sleep(10);
    // No polling should fire additional events without provider callbacks.
    expect(updateReasons).toHaveLength(1);

    providerChange.emit?.();
    expect(updateReasons).toHaveLength(2);

    unregister();
    expect(updateReasons).toHaveLength(3);
  });

  test('clear disposes provider subscriptions and emits one change event', () => {
    const updateListener = mock(() => {});
    const disposeProvider = mock(() => {});

    registry.subscribe(updateListener);
    registry.register({
      id: asTabDecorationProviderId('subscribed-provider'),
      priority: 1,
      provideDecoration: () => ({title: 'one'}),
      subscribe: () => disposeProvider
    });
    registry.register({
      id: asTabDecorationProviderId('plain-provider'),
      priority: 1,
      provideDecoration: () => ({title: 'two'})
    });

    const updatesBeforeClear = updateListener.mock.calls.length;
    registry.clear();

    expect(disposeProvider).toHaveBeenCalledTimes(1);
    expect(registry.listProviders()).toHaveLength(0);
    expect(updateListener.mock.calls.length).toBe(updatesBeforeClear + 1);
  });

  describe('error-tolerant behaviour', () => {
    beforeEach(() => {
      registry = new TabDecorationProviderRegistry(silentLogger);
    });

    test('resolve continues when one provider throws', () => {
      registry.register({
        id: asTabDecorationProviderId('failing-provider'),
        priority: 10,
        provideDecoration: () => {
          throw new Error('boom');
        }
      });
      registry.register({
        id: asTabDecorationProviderId('healthy-provider'),
        priority: 5,
        provideDecoration: () => ({title: 'healthy'})
      });

      const resolved = registry.resolve(buildContext());
      expect(resolved.title).toBe('healthy');
    });

    test.each([
      {
        description: 'empty ids',
        invalidId: '   '
      },
      {
        description: 'non-string ids',
        invalidId: 123
      }
    ])('ignores provider registrations with $description', ({invalidId}) => {
      const unregister = registry.register({
        id: invalidId,
        priority: 1,
        provideDecoration: () => ({title: 'ignored'})
      });

      expect(unregister).toEqual(expect.any(Function));
      expect(registry.listProviders()).toEqual([]);
    });
  });
});
