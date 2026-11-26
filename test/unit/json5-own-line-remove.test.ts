/**
 * @file Resetting an own-line property whose comma sits on a later line.
 *
 * A JSON5 object may put a property on its own line and its separating comma
 * after a comment on the next line. Removing the line alone would leave a
 * leading comma and an invalid document, so the writer's removal must delete
 * that comma too, keep the comment, and still report a successful write.
 */
import {describe, expect, test} from 'bun:test';
import JSON5 from 'json5';

import {
  asConfigFilePath,
  lastPathSegment,
  writeConfigEdit,
  type ConfigWriterDependencies,
  type ConfigWriteGuard
} from '../../app/config/config-file-writer';
import {checkWritePolicy} from '../../app/settings/settings-write-policy';
import {json5Document, propertyKey, removePropertyAtPath} from '../../app/config/json5';
import {createMemoryConfigFileSystem} from '../testUtils/config-file-port';

const CONFIG_PATH = '/home/user/.config/Hyper/config.json5';

const guard: ConfigWriteGuard = {
  checkPolicy: (segments, value) => checkWritePolicy(lastPathSegment(segments), value)
};

type WriterHarness = {
  readonly dependencies: ConfigWriterDependencies;
  readonly port: ReturnType<typeof createMemoryConfigFileSystem>;
};

const createDependencies = (): WriterHarness => {
  let revision = 0;
  const port = createMemoryConfigFileSystem();
  const dependencies: ConfigWriterDependencies = {
    currentRevision: () => revision,
    fileSystem: port,
    log: () => {},
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    platform: 'linux',
    processId: () => 42,
    recordWrittenText: () => {},
    sleep: async () => {
      await Promise.resolve();
    }
  };
  return {dependencies, port};
};

const cases = [
  {
    name: 'with a comment before the comma',
    doc: "{\n  config: {\n    fontSize: 14\n    /* keep */ , shell: 'bash'\n  }\n}\n",
    keepsComment: true
  },
  {
    name: 'without a comment before the comma',
    doc: "{\n  config: {\n    fontSize: 14\n    , shell: 'bash'\n  }\n}\n",
    keepsComment: false
  }
];

describe('an own-line property whose comma is on a later line', () => {
  for (const {name, doc, keepsComment} of cases) {
    test(`the edit removes the comma and leaves valid JSON5 ${name}`, () => {
      const result = removePropertyAtPath(json5Document(doc), [propertyKey('config'), propertyKey('fontSize')]);
      if (result.kind !== 'edited') {
        throw new Error(`expected an edit, got ${result.reason}`);
      }
      expect(() => JSON5.parse(result.doc)).not.toThrow();
      expect(JSON5.parse(result.doc)).toEqual({config: {shell: 'bash'}});
      expect(result.doc.includes('/* keep */')).toBe(keepsComment);
    });

    test(`the writer applies a reset ${name}`, async () => {
      const {dependencies, port} = createDependencies();
      port.setFile(CONFIG_PATH, doc);

      const outcome = await writeConfigEdit(
        dependencies,
        asConfigFilePath(CONFIG_PATH),
        {kind: 'remove', path: ['config', 'fontSize']},
        guard
      );

      expect(outcome.kind).toBe('written');
      const written = port.readFile(CONFIG_PATH) ?? '';
      expect(JSON5.parse(written)).toEqual({config: {shell: 'bash'}});
      expect(written.includes('/* keep */')).toBe(keepsComment);
    });
  }
});
