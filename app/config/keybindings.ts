/** @file JSON5-backed user keybindings storage, bootstrap, and import/export helpers. */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';

import type {configValidationDiagnostic} from '@shared/types/config';
import {keybindingsSchema, toRawKeymaps} from './keybindings-codec';
import {parseJson5WithSchemaDiagnostics, stringifyJson5, type ParseSchema} from './json5-config';

export type UserKeymaps = Record<string, string | string[]>;

type TextReader = (path: string, encoding: BufferEncoding) => string;
type TextWriter = (path: string, content: string, encoding: BufferEncoding) => void;
type PathExists = (path: string) => boolean;

type ConfigFilePath = {
  readonly path: string;
};

export type KeybindingsSource = {
  readonly filePath: ConfigFilePath;
  readonly rawContent: string;
};

type KeybindingsDependencies = {
  readonly filePath: string;
  readonly notify: (title: string, body?: string, details?: {error?: unknown}) => void;
  readonly warn?: typeof console.warn;
  readonly readFile?: TextReader;
  readonly writeFile?: TextWriter;
  readonly pathExists?: PathExists;
};

type KeybindingsLoadOptions = {
  readonly bootstrapFrom?: UserKeymaps;
};

type KeybindingsMutationResult = {
  readonly content: string;
  readonly diagnostics: readonly configValidationDiagnostic[];
  readonly keymaps: UserKeymaps;
  readonly usedFallback: boolean;
};

type KeybindingsLoadResult = {
  readonly diagnostics: readonly configValidationDiagnostic[];
  readonly keymaps: UserKeymaps;
  readonly usedFallback: boolean;
  readonly usedLastKnownGood: boolean;
};

const keymapSchema: ParseSchema<UserKeymaps> = keybindingsSchema;

const keymapDiagnosticHints = {
  '/': {
    docHint: 'Keymap entries map command ids to keybinding strings or arrays.',
    defaultHint: '{}'
  }
} as const;

export const parseKeybindingsSource = (source: KeybindingsSource) =>
  parseJson5WithSchemaDiagnostics({
    raw: source.rawContent,
    source: source.filePath.path,
    schema: keymapSchema,
    fallback: {},
    itemType: 'keymap',
    diagnosticHints: keymapDiagnosticHints
  });

const reportDiagnostics = (
  warnFn: typeof console.warn,
  context: string,
  source: ConfigFilePath,
  diagnostics: readonly configValidationDiagnostic[]
) => {
  if (diagnostics.length === 0) {
    return;
  }
  warnFn(`[config-keybindings] ${context}`, {source: source.path, diagnostics});
};

const stringifyKeybindings = (keymaps: UserKeymaps): string => stringifyJson5(keymaps);

export const createKeybindingsModule = (dependencies: KeybindingsDependencies) => {
  const notifyFn = dependencies.notify;
  const warnFn = dependencies.warn ?? console.warn;
  const readFile = dependencies.readFile ?? readFileSync;
  const writeFile = dependencies.writeFile ?? writeFileSync;
  const pathExists = dependencies.pathExists ?? existsSync;
  const keybindingsPath = dependencies.filePath;
  let lastKnownGoodKeymaps: UserKeymaps | undefined;

  const notifyWithPrimaryDiagnostic = (baseMessage: string, diagnostics: readonly configValidationDiagnostic[]) => {
    const primaryDiagnostic = diagnostics.at(0);
    if (!primaryDiagnostic) {
      notifyFn(baseMessage);
      return;
    }

    const docHint = primaryDiagnostic.docHint ? ` Hint: ${primaryDiagnostic.docHint}.` : '';
    const defaultHint = primaryDiagnostic.defaultHint ? ` Default: ${primaryDiagnostic.defaultHint}.` : '';
    notifyFn(
      `${baseMessage} ${primaryDiagnostic.path}: ${primaryDiagnostic.message} Suggested fix: ${primaryDiagnostic.suggestedFix}.${docHint}${defaultHint}`
    );
  };

  const buildFallbackResult = (
    diagnostics: readonly configValidationDiagnostic[],
    fallbackKeymaps?: UserKeymaps
  ): KeybindingsLoadResult => {
    const keymaps = fallbackKeymaps ?? lastKnownGoodKeymaps ?? {};
    return {
      diagnostics,
      keymaps: toRawKeymaps(keymaps),
      usedFallback: true,
      usedLastKnownGood: lastKnownGoodKeymaps !== undefined
    };
  };

  const ensureKeybindingsFile = (bootstrapFrom: UserKeymaps = {}) => {
    if (pathExists(keybindingsPath)) {
      return;
    }

    const initialKeymaps = toRawKeymaps(bootstrapFrom);
    warnFn(
      `[config-keybindings] User keybindings file missing at "${keybindingsPath}". Bootstrapping JSON5 keybindings.`
    );
    try {
      writeFile(keybindingsPath, stringifyKeybindings(initialKeymaps), 'utf8');
      lastKnownGoodKeymaps = initialKeymaps;
    } catch (error) {
      console.error(`[config-keybindings] Failed to write bootstrapped keybindings at "${keybindingsPath}".`, error);
      notifyFn("Couldn't create a keybindings file. Check permissions and available disk space.");
    }
  };

  const loadUserKeybindings = (options: KeybindingsLoadOptions = {}): KeybindingsLoadResult => {
    ensureKeybindingsFile(options.bootstrapFrom);
    const filePath: ConfigFilePath = {path: keybindingsPath};

    try {
      const keybindingsResult = parseKeybindingsSource({
        filePath,
        rawContent: readFile(keybindingsPath, 'utf8')
      });
      if (keybindingsResult.usedFallback) {
        reportDiagnostics(warnFn, 'User keybindings diagnostics.', filePath, keybindingsResult.diagnostics);
        notifyWithPrimaryDiagnostic(
          "Couldn't parse keybindings file. Keeping the last known good keybindings.",
          keybindingsResult.diagnostics
        );
        return buildFallbackResult(keybindingsResult.diagnostics, options.bootstrapFrom);
      }

      lastKnownGoodKeymaps = toRawKeymaps(keybindingsResult.value);
      return {
        diagnostics: keybindingsResult.diagnostics,
        keymaps: toRawKeymaps(keybindingsResult.value),
        usedFallback: false,
        usedLastKnownGood: false
      };
    } catch (error) {
      console.error(`[config-keybindings] Failed to read or parse keybindings at "${keybindingsPath}".`, error);
      notifyFn("Couldn't read keybindings file. Keeping the last known good keybindings.");
      return buildFallbackResult([], options.bootstrapFrom);
    }
  };

  const importKeybindings = (rawContent: string, sourceLabel = keybindingsPath): KeybindingsMutationResult => {
    const parsed = parseKeybindingsSource({
      filePath: {path: sourceLabel},
      rawContent
    });

    if (parsed.usedFallback) {
      return {
        content: stringifyKeybindings(lastKnownGoodKeymaps ?? {}),
        diagnostics: parsed.diagnostics,
        keymaps: toRawKeymaps(lastKnownGoodKeymaps ?? {}),
        usedFallback: true
      };
    }

    const normalizedKeymaps = toRawKeymaps(parsed.value);
    const content = stringifyKeybindings(normalizedKeymaps);
    writeFile(keybindingsPath, content, 'utf8');
    lastKnownGoodKeymaps = normalizedKeymaps;
    return {
      content,
      diagnostics: parsed.diagnostics,
      keymaps: toRawKeymaps(normalizedKeymaps),
      usedFallback: false
    };
  };

  const exportKeybindings = (): KeybindingsMutationResult => {
    const loaded = loadUserKeybindings();
    const content = stringifyKeybindings(loaded.keymaps);
    return {
      content,
      diagnostics: loaded.diagnostics,
      keymaps: loaded.keymaps,
      usedFallback: loaded.usedFallback
    };
  };

  return {
    ensureKeybindingsFile,
    loadUserKeybindings,
    importKeybindings,
    exportKeybindings,
    stringifyKeybindings
  };
};
