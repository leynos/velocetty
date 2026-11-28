/**
 * @file Container for the Hyper window UI.
 * Responsible for wiring keybindings, focus management, and RPC-driven
 * actions
 * while rendering the header, terms, and notification surfaces for the app.
 * Used as the top-level React container in the renderer window.
 */
import type React from 'react';
import {forwardRef, useEffect, useRef} from 'react';

import stylis from 'stylis';

import type {HyperState, HyperProps} from '../../typings/hyper';
import type Terms from '../components/terms';
import {useDispatcherBundle} from '../command-dispatch/inbound/command-dispatcher-provider';
import {transport} from '../transport';
import {connect} from '../utils/plugins';

import {HeaderContainer} from './header';
import NotificationsContainer from './notifications';
import TermsContainer from './terms';
import * as styles from './hyper.module.css';

const isMac = /Mac/.test(navigator.userAgent);

const Hyper = forwardRef(function Hyper(props: HyperProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const terms = useRef<Terms | null>(null);
  const bundle = useDispatcherBundle();

  useEffect(() => {
    if (!bundle) {
      return;
    }
    void bundle.keybindings.reload();
  }, [bundle, props.lastConfigUpdate]);

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
      bundle?.keybindings.reset();
    };
  }, [bundle]);

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
    isMac,
    customCSS: state.ui.css,
    uiFontFamily: state.ui.uiFontFamily,
    borderColor: state.ui.borderColor,
    activeSession: state.sessions.activeUid,
    backgroundColor: state.ui.backgroundColor,
    maximized: state.ui.maximized,
    fullScreen: state.ui.fullScreen,
    lastConfigUpdate: state.ui._lastUpdate
  };
};

const mapDispatchToProps = () => ({});

const HyperContainer = connect(mapStateToProps, mapDispatchToProps, undefined, {forwardRef: true})(Hyper, 'Hyper');

export default HyperContainer;

export type HyperConnectedProps = ReturnType<typeof mapStateToProps>;
