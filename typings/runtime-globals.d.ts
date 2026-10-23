/** @file Shared runtime global typings used across app and renderer modules. */

export type VelocettyRuntimeGlobals = {
  __velocettyAppRoot?: string;
};

declare global {
  /**
   * The profile the renderer window was opened with.
   *
   * Installed as an accessor by `lib/utils/config.ts` rather than assigned, so
   * it is readable everywhere but only the defining module can set it. Typed as
   * a plain `string` to mirror `Window.profileName`, which the same renderer
   * populates.
   */
  var profileName: string;

  /**
   * Focuses the active terminal, or the terminal identified by `uid`.
   *
   * Optional because the renderer only installs it once the terms container
   * mounts; callers reached before that point must tolerate its absence.
   */
  var focusActiveTerm: ((uid?: string) => void) | undefined;
}
