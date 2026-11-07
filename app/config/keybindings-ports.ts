/** @file Neutral ports, outcomes, and notices for the keybindings service. */
/*
 * This module is the domain boundary for `keybindings.ts`. Everything here is
 * presentation-free: no filesystem paths, raw errors, cleanup hooks, or
 * notification vocabulary. The file adapter translates raw failures into the
 * bounded `KeybindingsStorageFailure` below, and the edge maps the notices the
 * service emits onto the strings a user reads.
 */
import type {configValidationDiagnostic} from '@shared/types/config';
import type {UserKeymaps} from './keybindings-policy';

/**
 * The bounded reason a read or write failed.
 *
 * A raw errno or `Error` never crosses the port: arbitrary text cannot be
 * aggregated safely, and a caller that needs the raw error gets it from the
 * adapter's own log sink.
 */
export type KeybindingsStorageFailure = 'permission' | 'missing' | 'other';

/** Which keymaps are in effect after a rejected read. */
export type KeybindingsBasis = 'last-known-good' | 'empty';

/** What reading the keybindings file observed. */
export type KeybindingsReadOutcome =
  | {readonly kind: 'present'; readonly text: string}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly failure: KeybindingsStorageFailure};

/** What writing the keybindings file did. */
export type KeybindingsWriteOutcome =
  | {readonly kind: 'written'}
  | {readonly kind: 'failed'; readonly failure: KeybindingsStorageFailure};

/** The driven port the keybindings service reads and writes through. */
export type KeybindingsStore = {
  /** A short human label such as `keybindings.json5`, never a filesystem path. */
  readonly label: string;
  /**
   * Reads the file as part of the service's own work.
   *
   * The adapter records a read span and warns when the file cannot be read, so
   * this is the method for loads and reloads that the user should see.
   */
  readonly read: () => KeybindingsReadOutcome;
  /**
   * Reads the file without recording a span or warning.
   *
   * Export is a query over what is stored, not a service operation, so it must
   * not add noise to the read telemetry.
   */
  readonly peek: () => KeybindingsReadOutcome;
  readonly write: (text: string) => KeybindingsWriteOutcome;
};

/** The text codec port: parsing and serializing stay behind this boundary. */
export type KeybindingsTextCodec = {
  readonly parse: (
    text: string,
    label: string
  ) =>
    | {readonly kind: 'ok'; readonly keymaps: UserKeymaps}
    | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]};
  readonly serialize: (keymaps: UserKeymaps) => string;
};

/**
 * The closed vocabulary of things the service wants reported.
 *
 * The service names what happened and the bounded basis or failure; composing
 * the sentence a user reads is the edge's job.
 */
export type KeybindingsNotice =
  | {
      readonly basis: KeybindingsBasis;
      readonly diagnostics: readonly configValidationDiagnostic[];
      readonly kind: 'invalid-file';
    }
  | {
      readonly basis: KeybindingsBasis;
      readonly failure: KeybindingsStorageFailure;
      readonly kind: 'unreadable-file';
    }
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'seed-failed'}
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'import-failed'}
  | {
      readonly diagnostics: readonly configValidationDiagnostic[];
      readonly kind: 'diagnostics';
      readonly label: string;
    };

/** Reports one bounded notice without deciding how it is presented. */
export type KeybindingsReporter = (notice: KeybindingsNotice) => void;

/** What a start or reload left in effect. */
export type KeybindingsLoadOutcome =
  | {
      readonly kind: 'applied';
      readonly keymaps: UserKeymaps;
      /**
       * `seeded-unsaved` means the seed was applied in memory but the file
       * could not be written, so nothing was migrated on disk.
       */
      readonly origin: 'file' | 'missing' | 'seeded' | 'seeded-unsaved';
    }
  | {
      readonly kind: 'kept';
      readonly keymaps: UserKeymaps;
      readonly basis: KeybindingsBasis;
      readonly cause: 'invalid' | 'unreadable' | 'deferred';
      readonly diagnostics: readonly configValidationDiagnostic[];
    };

/** Text supplied by an importer, with the name its diagnostics should cite. */
export type KeybindingsImportRequest = Readonly<{
  readonly sourceLabel: string;
  readonly text: string;
}>;

/** What importing user-supplied text did. */
export type KeybindingsImportOutcome =
  | {readonly kind: 'written'}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'failed'; readonly failure: KeybindingsStorageFailure};

/** What the stored keybindings contain, read without side effects. */
export type KeybindingsExport =
  | {readonly kind: 'stored'; readonly text: string}
  | {readonly kind: 'invalid'; readonly text: string; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly failure: KeybindingsStorageFailure};
