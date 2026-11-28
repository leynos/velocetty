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

import {asCommandId, type CommandId} from '@shared/types/commands';
import type {HyperState, HyperProps, HyperDispatch} from '../../typings/hyper';
import * as uiActions from '../actions/ui';
import {getRegisteredKeys, getCommandHandler, shouldPreventDefault} from '../command-registry';
import {isSettingsSurfaceGated} from '../settings/surface-command-gate';
import type Terms from '../components/terms';
import {transport} from '../transport';
import {connect} from '../utils/plugins';

import {HeaderContainer} from './header';
import NotificationsContainer from './notifications';
import SettingsContainer from './settings';
import TermsContainer from './terms';
import * as styles from './hyper.module.css';

const isMac = /Mac/.test(navigator.userAgent);

const Hyper = forwardRef(function Hyper(props: HyperProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const mousetrap = useRef<MousetrapInstance | null>(null);
  const terms = useRef<Terms | null>(null);
  // `attachKeyListeners` waits for the registry, so a later attach can start
  // while an earlier one is still pending. The id lets the older call notice it
  // has been superseded and skip binding keys that are already out of date.
  const keyListenerRegistration = useRef(0);

  useEffect(() => {
    void attachKeyListeners();
  }, [props.execCommand, props.lastConfigUpdate, props.isSettingsSurfaceActive]);
  useEffect(() => {
    handleFocusActive(props.activeSession);
  }, [props.activeSession]);
  useEffect(() => {
    // Returning from settings restores focus explicitly: the terminal keeps
    // its session, and the browser does not focus it for us.
    if (!props.isSettingsSurfaceActive) {
      handleFocusActive(props.activeSession);
    }
  }, [props.isSettingsSurfaceActive]);

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
    const registrationId = ++keyListenerRegistration.current;
    if (mousetrap.current) {
      mousetrap.current.reset();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mousetrap.current = Mousetrap(document.body);
      mousetrap.current!.stopCallback = () => {
        // All events should be intercepted even if focus is in an input/textarea
        return false;
      };
    }

    const keys = await getRegisteredKeys();
    if (registrationId !== keyListenerRegistration.current) {
      // A newer attachment (or unmount) superseded this one: binding now would
      // restore stale keys over the newer set.
      return;
    }
    Object.keys(keys).forEach((commandKeys) => {
      mousetrap.current?.bind(
        commandKeys,
        (e) => {
          const command = asCommandId(keys[commandKeys]);
          // We should tell xterm to ignore this event.
          const caughtEvent = Object.assign(e, {catched: true});
          const isGated = props.isSettingsSurfaceActive && isSettingsSurfaceGated(command);
          props.execCommand(command, getCommandHandler(command), caughtEvent);
          // A gated command leaves native behaviour alone, so typing and
          // editing shortcuts work in the settings inputs.
          !isGated && shouldPreventDefault(command) && e.preventDefault();
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
    globalThis.focusActiveTerm = (uid?: string) => {
      if (uid) {
        handleFocusActive(uid);
      } else {
        terms.current?.getActiveTerm()?.focus();
      }
    };
  };

  useEffect(() => {
    return () => {
      // Invalidate any attachment still waiting on the registry, so it cannot
      // bind keys into a reset mousetrap after the window has gone.
      keyListenerRegistration.current += 1;
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
        <div className={styles.surfaceHost}>
          <div
            className={`${styles.surfaceLayer} ${props.isSettingsSurfaceActive ? styles.surfaceLayerOffscreen : ''}`}
            inert={props.isSettingsSurfaceActive}
          >
            <TermsContainer ref_={onTermsRef} />
          </div>
          {props.isSettingsOpen && (
            <div
              className={`${styles.surfaceLayer} ${props.isSettingsSurfaceActive ? '' : styles.surfaceLayerOffscreen}`}
              inert={!props.isSettingsSurfaceActive}
            >
              <SettingsContainer isActive={props.isSettingsSurfaceActive} />
            </div>
          )}
        </div>
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
    isMac,
    customCSS: state.ui.css,
    uiFontFamily: state.ui.uiFontFamily,
    borderColor: state.ui.borderColor,
    activeSession: state.sessions.activeUid,
    isSettingsSurfaceActive: state.settingsTab.isActive,
    isSettingsOpen: state.settingsTab.isOpen,
    backgroundColor: state.ui.backgroundColor,
    maximized: state.ui.maximized,
    fullScreen: state.ui.fullScreen,
    lastConfigUpdate: state.ui._lastUpdate
  };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    execCommand: (command: CommandId, fn: ((e: unknown, dispatch: HyperDispatch) => void) | undefined, e: unknown) => {
      dispatch(uiActions.execCommand(command, fn, e));
    }
  };
};

const HyperContainer = connect(mapStateToProps, mapDispatchToProps, null, {forwardRef: true})(Hyper, 'Hyper');

export default HyperContainer;

export type HyperConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
