/** @file Connects terminal state and actions to the Terms component. */
import type React from 'react';

import type {HyperState, HyperDispatch} from '../../typings/hyper';
import {
  resizeSession,
  sendSessionData,
  setSessionXtermTitle,
  setActiveSession,
  openSearch,
  closeSearch
} from '../actions/sessions';
import {openContextMenu} from '../actions/ui';
import Terms from '../components/terms';
import {getRootGroups} from '../selectors';
import {connect} from '../utils/plugins';

const mapStateToProps = (state: HyperState) => {
  const {sessions} = state.sessions;
  return {
    /** All sessions keyed by uid, backing the terms rendered for each pane. */
    sessions,
    /** Terminal column count, when not driven by pane auto-fit. */
    cols: state.ui.cols,
    /** Terminal row count, when not driven by pane auto-fit. */
    rows: state.ui.rows,
    /** Number of scrollback lines retained per terminal. */
    scrollback: state.ui.scrollback,
    /** Root term-group tree describing the current split layout. */
    termGroups: getRootGroups(state),
    /** Uid of the root term group whose tab is currently active. */
    activeRootGroup: state.termGroups.activeRootGroup,
    /** Uid of the currently focused session, used to mark its terminal active. */
    activeSession: state.sessions.activeUid,
    /** User-supplied CSS injected into every terminal pane. */
    customCSS: state.ui.termCSS,
    /** Whether pty writes are permitted, used to gate terminal input. */
    write: state.sessions.write,
    /** Effective font size, honouring any temporary font-size override. */
    fontSize: state.ui.fontSizeOverride ? state.ui.fontSizeOverride : state.ui.fontSize,
    /** Terminal font family. */
    fontFamily: state.ui.fontFamily,
    /** Terminal font weight for regular text. */
    fontWeight: state.ui.fontWeight,
    /** Terminal font weight for bold text. */
    fontWeightBold: state.ui.fontWeightBold,
    /** Terminal line height multiplier. */
    lineHeight: state.ui.lineHeight,
    /** Terminal letter spacing, in pixels. */
    letterSpacing: state.ui.letterSpacing,
    /** Font family used for UI chrome such as the search box. */
    uiFontFamily: state.ui.uiFontFamily,
    /** Font-smoothing override applied to terminal text rendering. */
    fontSmoothing: state.ui.fontSmoothingOverride,
    /** CSS padding applied inside each terminal pane. */
    padding: state.ui.padding,
    /** Cursor colour. */
    cursorColor: state.ui.cursorColor,
    /** Cursor accent colour, used with block cursors to colour the character underneath. */
    cursorAccentColor: state.ui.cursorAccentColor,
    /** Cursor shape (bar, underline, or block). */
    cursorShape: state.ui.cursorShape,
    /** Whether the cursor blinks. */
    cursorBlink: state.ui.cursorBlink,
    /** Border colour used for pane dividers and other terminal chrome. */
    borderColor: state.ui.borderColor,
    /** Selection highlight colour. */
    selectionColor: state.ui.selectionColor,
    /** ANSI colour palette applied to terminal output. */
    colors: state.ui.colors,
    /** Terminal foreground (text) colour. */
    foregroundColor: state.ui.foregroundColor,
    /** Terminal background colour. */
    backgroundColor: state.ui.backgroundColor,
    /** Bell mode, controlling whether the terminal bell plays a sound. */
    bell: state.ui.bell,
    /** URL of a user-supplied bell sound file. */
    bellSoundURL: state.ui.bellSoundURL,
    /** Base64-encoded bell sound data, when configured inline rather than by URL. */
    bellSound: state.ui.bellSound,
    /** Whether selecting text also copies it to the clipboard. */
    copyOnSelect: state.ui.copyOnSelect,
    /** Modifier-key behaviour overrides (e.g. treating Option as Meta on macOS). */
    modifierKeys: state.ui.modifierKeys,
    /** Enables the right-click quick-edit copy/paste shortcut. */
    quickEdit: state.ui.quickEdit,
    /** Whether the WebGL renderer is enabled. */
    webGLRenderer: state.ui.webGLRenderer,
    /** Maximum number of concurrent WebGL contexts shared across terminals. */
    webGLRendererMaxContexts: state.ui.webGLRendererMaxContexts,
    /** Modifier key that must be held to activate clickable web links. */
    webLinksActivationKey: state.ui.webLinksActivationKey,
    /** macOS Option-key selection mode (e.g. force rectangular selection). */
    macOptionSelectionMode: state.ui.macOptionSelectionMode,
    /** Disables font ligature rendering. */
    disableLigatures: state.ui.disableLigatures,
    /** Enables accessibility-friendly rendering for screen readers. */
    screenReaderMode: state.ui.screenReaderMode,
    /** Windows-specific pty configuration (e.g. ConPTY options). */
    windowsPty: state.ui.windowsPty,
    /** Enables inline image rendering (Sixel/iTerm2 image protocols) in the terminal. */
    imageSupport: state.ui.imageSupport
  };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    /** Forwards terminal input to the session's pty. */
    onData(uid: string, data: string) {
      dispatch(sendSessionData({uid, data}));
    },

    /** Updates the session's title from an xterm title-change event. */
    onTitle(uid: string, title: string) {
      dispatch(setSessionXtermTitle(uid, title));
    },

    /** Records a terminal resize so the pty can be resized to match. */
    onResize(uid: string, cols: number, rows: number) {
      dispatch(resizeSession(uid, cols, rows));
    },

    /** Marks the session active when its terminal gains focus. */
    onActive(uid: string) {
      dispatch(setActiveSession(uid));
    },

    /** Opens the find-in-terminal search box for the session. */
    onOpenSearch(uid: string) {
      dispatch(openSearch(uid));
    },

    /** Closes the find-in-terminal search box for the session. */
    onCloseSearch(uid: string) {
      dispatch(closeSearch(uid));
    },

    /** Activates the session and opens its context menu for the given selection. */
    onContextMenu(uid: string, selection: string) {
      dispatch(setActiveSession(uid));
      dispatch(openContextMenu(uid, selection));
    }
  };
};

/** Props supplied to the terminal group by `connect`, combining state selections and dispatch bindings. */
export type TermsConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
type TermsContainerProps = Omit<React.ComponentProps<typeof Terms>, keyof TermsConnectedProps>;

/** Terminal group container, connected to session state, terminal styling, and session actions. */
const TermsContainer = connect(mapStateToProps, mapDispatchToProps, null, {forwardRef: true})(
  Terms,
  'Terms'
) as React.ComponentType<TermsContainerProps>;

export default TermsContainer;
