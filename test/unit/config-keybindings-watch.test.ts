/** @file Verifies the config watcher covers both files and reports reloads honestly. */
import path from 'node:path';

import {expect, mock, spyOn, test} from 'bun:test';

import {createWatchHarness, makeParsedConfig, settle} from '../testUtils/config-watch-harness';

test.serial('setup watches the configuration directory once, filtered to both files', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();

    expect(harness.watchMock).toHaveBeenCalledTimes(1);
    // The active config and the keybindings file share `/tmp`, so one
    // directory watch covers both without watching the tree recursively.
    // `path.resolve` makes the expectation portable: Windows turns the
    // mock's `/tmp` into a drive-qualified path.
    expect(harness.watchMock.mock.calls[0]?.[0]).toEqual([path.resolve('/tmp')]);
    expect(harness.watchMock.mock.calls[0]?.[1]).toEqual({depth: 0, ignoreInitial: true});
  } finally {
    mock.restore();
  }
});

test.serial('start-up cleans stale temporary files at the edge before the seed decision', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();

    // The composition root owns cleanup, and it must run before the import
    // that decides whether to seed the file.
    expect(harness.storeCleanupMock).toHaveBeenCalledTimes(1);
    expect(harness.callOrder.slice(0, 2)).toEqual(['cleanup', 'import']);
  } finally {
    mock.restore();
  }
});

test.serial('add and unlink events reload, and only applied reports notify', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    harness.setConfig(makeParsedConfig({'window:new': ['ctrl+shift+n']}));

    harness.emit({event: 'add', eventPath: '/tmp/keybindings.json5'});
    await settle();

    expect(harness.importMock.mock.calls.map(([phase]) => phase)).toEqual(['startup', 'reload']);
    expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock).toHaveBeenCalledWith('Configuration updated', 'Configuration reloaded!');

    harness.setReport({config: 'applied', keybindings: 'kept'});
    harness.emit({event: 'unlink', eventPath: '/tmp/keybindings.json5'});
    await settle();

    expect(harness.importMock).toHaveBeenCalledTimes(3);
    expect(harness.subscriberMock).toHaveBeenCalledTimes(2);
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);

    harness.setReport({config: 'fallback', keybindings: 'applied'});
    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await settle();

    expect(harness.importMock).toHaveBeenCalledTimes(4);
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
  } finally {
    mock.restore();
  }
});

test.serial('an unreadable keybindings file is recorded and counted without notifying', async () => {
  const harness = await createWatchHarness();
  // The composition root's recorder writes to the real console, so the record
  // it emits is captured here rather than through an injected sink.
  const infoSpy = spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    harness.setReport({config: 'applied', keybindings: 'kept'});
    harness.setOutcome({basis: 'last-known-good', cause: 'unreadable', diagnostics: [], keymaps: {}, kind: 'kept'});

    harness.emit({event: 'change', eventPath: '/tmp/keybindings.json5'});
    await settle();

    const decisionLines = infoSpy.mock.calls
      .map(([line]) => line)
      .filter((line) => line.startsWith('[config] import decision'));
    expect(decisionLines).toHaveLength(2);
    expect(decisionLines[1]).toBe(
      '[config] import decision phase=reload config=applied configSource=velocetty keybindings=kept ' +
        'basis=last-known-good cause=unreadable announced=false ' +
        'attempts:2,applies:1,parseFailures:0,readFailures:1,fallbacks:0,importFailures:0,retries:0'
    );
    // The service owns the user-facing diagnostic; the watcher stays quiet and
    // still dispatches the reload to its subscribers.
    expect(harness.notifyMock).not.toHaveBeenCalled();
    expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  } finally {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    mock.restore();
  }
});

test.serial('a thrown reload is counted, recorded, and still reported by the watcher', async () => {
  const harness = await createWatchHarness();
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    harness.importMock.mockImplementation(() => {
      throw new Error('boom');
    });

    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await settle();

    expect(warnSpy.mock.calls.map(([line]) => line)).toEqual([
      '[config] import failure phase=reload cause=thrown ' +
        'attempts:2,applies:1,parseFailures:0,readFailures:0,fallbacks:0,importFailures:1,retries:0',
      '[config-watcher] Configuration reload failed.'
    ]);
    expect(harness.notifyMock).not.toHaveBeenCalled();
    expect(harness.subscriberMock).not.toHaveBeenCalled();
  } finally {
    warnSpy.mockRestore();
    mock.restore();
  }
});

test.serial('a thrown startup import is counted, recorded, and rethrown', async () => {
  const harness = await createWatchHarness();
  const infoSpy = spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    harness.importMock.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => harness.configModule.setup()).toThrow('boom');

    // Start-up has no per-file outcome, so the failure record and the thrown
    // span are the only evidence that the import ran at all.
    expect(warnSpy.mock.calls.map(([line]) => line)).toEqual([
      '[config] import failure phase=startup cause=thrown ' +
        'attempts:1,applies:0,parseFailures:0,readFailures:0,fallbacks:0,importFailures:1,retries:0'
    ]);
    expect(infoSpy.mock.calls.map(([line]) => line).filter((line) => line.startsWith('[config] span'))).toEqual([
      expect.stringMatching(/^\[config\] span operation=startup outcome=thrown ms=\d+$/)
    ]);
  } finally {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    mock.restore();
  }
});

test.serial('a dispatched reload records both spans with the real outcome', async () => {
  const harness = await createWatchHarness();
  const infoSpy = spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  const spanLines = () => infoSpy.mock.calls.map(([line]) => line).filter((line) => line.startsWith('[config] span'));
  try {
    harness.configModule.setup();
    // Start-up has its own span; this test is about the reload pair.
    infoSpy.mockClear();
    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await settle();

    // The reload span closes before the decision is recorded; the watcher's
    // own span closes last, once the dispatch has fully returned.
    expect(spanLines()).toEqual([
      expect.stringMatching(/^\[config\] span operation=reload outcome=applied ms=\d+$/),
      expect.stringMatching(/^\[config\] span operation=watcher-dispatch outcome=applied ms=\d+$/)
    ]);

    infoSpy.mockClear();
    harness.setReport({config: 'fallback', keybindings: 'applied'});
    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await settle();
    expect(spanLines()[0]).toMatch(/^\[config\] span operation=reload outcome=fallback ms=\d+$/);

    infoSpy.mockClear();
    harness.importMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await settle();
    expect(spanLines().map((line) => line.replace(/ ms=\d+$/, ''))).toEqual([
      '[config] span operation=reload outcome=thrown',
      '[config] span operation=watcher-dispatch outcome=thrown'
    ]);
  } finally {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    mock.restore();
  }
});

test.serial('a burst touching both files reloads once and stays quiet when keybindings are kept', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    harness.setReport({config: 'applied', keybindings: 'kept'});

    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await new Promise((resolve) => setTimeout(resolve, 20));
    harness.emit({event: 'change', eventPath: '/tmp/keybindings.json5'});
    await settle();

    expect(harness.importMock.mock.calls.map(([phase]) => phase)).toEqual(['startup', 'reload']);
    expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock).not.toHaveBeenCalled();
  } finally {
    mock.restore();
  }
});

test.serial('events for unwatched files do not reload', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    harness.emit({event: 'change', eventPath: '/tmp/schema.json'});
    await settle();
    expect(harness.importMock.mock.calls.map(([phase]) => phase)).toEqual(['startup']);
  } finally {
    mock.restore();
  }
});

test.serial('the watcher closes on before-quit', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    const quitHandler = harness.appOnMock.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    expect(quitHandler).toBeFunction();
    // SAFETY: the matcher above fails the test unless a handler was registered.
    const notifyQuit = quitHandler as () => void;

    notifyQuit();

    expect(harness.watcherMock.close).toHaveBeenCalledTimes(1);
  } finally {
    mock.restore();
  }
});
