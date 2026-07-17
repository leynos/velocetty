/**
 * @file Container for the Hyper window UI.
 * Responsible for wiring keybindings, focus management, and RPC-driven
 * actions
 * while rendering the header, terms, and notification surfaces for the app.
 * Used as the top-level React container in the renderer window.
 */
import type React from 'react';
import {forwardRef, useEffect, useRef} from 'react';

import Mousetrap from 'mousetrap';
import type {MousetrapInstance} from 'mousetrap';
import stylis from 'stylis';

import type {CommandId} from '@shared/types/commands';
import type {HyperState, HyperProps, HyperDispatch} from '../../typings/hyper';
import * as uiActions from '../actions/ui';
import {getRegisteredKeys, getCommandHandler, shouldPreventDefault} from '../command-registry';
import type Terms from '../components/terms';
import {transport} from '../transport';
import {connect} from '../utils/plugins';

import {HeaderContainer} from './header';
import NotificationsContainer from './notifications';
import TermsContainer from './terms';
import * as styles from './hyper.module.css';

const isMac = /Mac/.test(navigator.userAgent);

const Hyper = forwardRef(function Hyper(props: HyperProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const mousetrap = useRef<MousetrapInstance | null>(null);
  const terms = useRef<Terms | null>(null);

  useEffect(() => {
    void attachKeyListeners();
  }, [props.execCommand, props.lastConfigUpdate]);
  useEffect(() => {
    handleFocusActive(props.activeSession);
  }, [props.activeSession]);

  const handleFocusActive = (uid?: string | null) => {
    const term = uid && terms.current?.getTermByUid(uid);
    if (term) {
      term.focus();
    }
  };

  const handleSelectAll = () => {
    const term = terms.current?.getActiveTerm();
    if (term) {
      term.selectAll();
    }
  };

  const attachKeyListeners = async () => {
    if (!mousetrap.current) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mousetrap.current = new (Mousetrap as any)(window, true);
      mousetrap.current!.stopCallback = () => {
        // All events should be intercepted even if focus is in an input/textarea
        return false;
      };
    } else {
      mousetrap.current.reset();
    }

    const keys = await getRegisteredKeys();
    Object.keys(keys).forEach((commandKeys) => {
      mousetrap.current?.bind(
        commandKeys,
        (e) => {
          const command = keys[commandKeys] as CommandId;
          // We should tell xterm to ignore this event.
          (e as any).catched = true;
          props.execCommand(command, getCommandHandler(command), e);
          shouldPreventDefault(command) && e.preventDefault();
        },
        'keydown'
      );
    });
  };

  useEffect(() => {
    const onSelectAll = handleSelectAll;
    transport.on('term selectAll', onSelectAll);
    return () => {
      transport.off('term selectAll', onSelectAll);
    };
  }, []);

  const onTermsRef = (_terms: Terms | null) => {
    terms.current = _terms;
    window.focusActiveTerm = (uid?: string) => {
      if (uid) {
        handleFocusActive(uid);
      } else {
        terms.current?.getActiveTerm()?.focus();
      }
    };
  };

  useEffect(() => {
    return () => {
      mousetrap.current?.reset();
    };
  }, []);

  const {isMac: isMac_, customCSS, uiFontFamily, borderColor, maximized, fullScreen} = props;
  const borderWidth = isMac_ ? '' : `${maximized ? '0' : '1'}px`;
  stylis.set({prefix: false});
  return (
    <div id="hyper" ref={ref}>
      <div
        style={{fontFamily: uiFontFamily, borderColor, borderWidth}}
        className={`${styles.hyperMain} ${isMac_ ? styles.hyperMainRounded : ''} ${fullScreen ? 'fullScreen' : ''}`}
      >
        <HeaderContainer />
        <TermsContainer ref_={onTermsRef} />
        {props.customInnerChildren}
      </div>

      <NotificationsContainer />

      {props.customChildren}

      {/*
        Add custom CSS to Hyper.
        We add a scope to the customCSS so that it applies within the Hyper container.
      */}
      <style dangerouslySetInnerHTML={{__html: stylis('#hyper', customCSS)}} />
    </div>
  );
});

Hyper.displayName = 'Hyper';

const mapStateToProps = (state: HyperState) => {
  return {
    /** Whether the renderer is running on macOS, so chrome can match platform conventions. */
    isMac,
    /** User-supplied custom CSS, scoped to the `#hyper` container and injected at render time. */
    customCSS: state.ui.css,
    /** Font family applied to header and other chrome text. */
    uiFontFamily: state.ui.uiFontFamily,
    /** Window border colour, sourced from the active theme/config. */
    borderColor: state.ui.borderColor,
    /** Uid of the currently active session, used to keep terminal focus in sync. */
    activeSession: state.sessions.activeUid,
    /** Window background colour, sourced from the active theme/config. */
    backgroundColor: state.ui.backgroundColor,
    /** Whether the window is currently maximized, used to size the border. */
    maximized: state.ui.maximized,
    /** Whether the window is in fullscreen, toggling the rounded-corner chrome. */
    fullScreen: state.ui.fullScreen,
    /** Timestamp of the last config update, used to re-attach key listeners on config change. */
    lastConfigUpdate: state.ui._lastUpdate
  };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    /** Runs a registered command handler for the given keybinding-triggered command. */
    execCommand: (command: CommandId, fn: ((e: unknown, dispatch: HyperDispatch) => void) | undefined, e: unknown) => {
      dispatch(uiActions.execCommand(command, fn, e));
    }
  };
};

/** Top-level Hyper window container, connected to renderer state and command dispatch. */
const HyperContainer = connect(mapStateToProps, mapDispatchToProps, null, {forwardRef: true})(Hyper, 'Hyper');

export default HyperContainer;

/** Props supplied to the Hyper window by `connect`, combining state selections and dispatch bindings. */
export type HyperConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
