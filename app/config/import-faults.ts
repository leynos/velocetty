/** @file Announces bundled-file faults to the user, at most once per process. */
/*
 * A missing or unparseable bundled file is a packaging fault the user can act
 * on, so it is announced at the moment start-up acts on it. The once-only
 * guards live here rather than in the read, so a reload or a second call cannot
 * repeat a notice the user has already seen.
 */
import type {LoadedDefaults} from './import-defaults';
import type {ImportFaultLogging} from './import-fault-logging';
import type {ConfigImportNotify} from './import-report';
import {notifyWithPrimaryDiagnostic} from './keybindings-notifier';

/** The notification and log surfaces a fault notice needs. */
export type ImportFaultNoticesDependencies = {
  notify: ConfigImportNotify;
  /** The unbound fault logs, so each notice and its log line stay together. */
  reportFaultLog: ImportFaultLogging;
};

/**
 * Creates the once-only announcements for the bundled defaults and keymap.
 *
 * Named separately because a missing file is a packaging fault the user can
 * act on, while a parse fault points at the shipped content.
 *
 * @example
 * ```ts
 * const notices = createImportFaultNotices({notify, reportFaultLog});
 * notices.announceDefaults(loaded); // notifies and logs at most once per fault
 * ```
 */
export const createImportFaultNotices = (dependencies: ImportFaultNoticesDependencies) => {
  const {notify: notifyFn, reportFaultLog} = dependencies;
  let hasAnnouncedDefaultFaults = false;
  let hasAnnouncedPlatformKeymapFault = false;

  /**
   * Tells the user once that the bundled defaults could not be read or parsed.
   *
   * Called from the start-up command, never from the read-only query, so
   * bootstrapping is announced at the moment the application acts on it.
   */
  const announceDefaults = (loaded: LoadedDefaults): void => {
    const {diagnostics, failure, platformKeymapDiagnostics, platformKeymapFailure, platformKeymapFault, usedFallback} =
      loaded;
    if (usedFallback && !hasAnnouncedDefaultFaults) {
      hasAnnouncedDefaultFaults = true;
      reportFaultLog.reportDefaultConfigFault(failure, diagnostics);
      const fault = failure === 'read' ? 'read' : 'parse';
      notifyWithPrimaryDiagnostic({
        baseMessage: `Couldn't ${fault} the bundled default config. Falling back to safe defaults.`,
        diagnostics,
        notify: notifyFn
      });
    }
    if (platformKeymapFault && !hasAnnouncedPlatformKeymapFault) {
      hasAnnouncedPlatformKeymapFault = true;
      reportFaultLog.reportPlatformKeymapFault(platformKeymapFailure, platformKeymapDiagnostics);
      notifyFn(
        "Couldn't read the bundled platform keymap. Starting without the platform shortcuts.",
        'Reinstall Velocetty, or check that the application files were not modified.'
      );
    }
  };

  return {announceDefaults};
};
