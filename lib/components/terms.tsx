/** @file Container component managing multiple terminal groups and sessions. */

import React from 'react';

import type {TermsProps, HyperDispatch} from '../../typings/hyper';
import {registerCommandHandlers} from '../command-registry';
import {ObjectTypedKeys} from '../utils/object';
import {decorate, getTermGroupProps} from '../utils/plugins';

import StyleSheet_ from './style-sheet';
import type Term from './term';
import TermGroup_ from './term-group';
import styles from './terms.module.css';

const TermGroup = decorate(TermGroup_, 'TermGroup');
const StyleSheet = decorate(StyleSheet_, 'StyleSheet');

const isMac = /Mac/.test(navigator.userAgent);

export default class Terms extends React.Component<React.PropsWithChildren<TermsProps>> {
  terms: Record<string, Term>;
  registerCommands: (cmds: Record<string, (e: unknown, dispatch: HyperDispatch) => void>) => void;
  constructor(props: TermsProps, context: any) {
    super(props, context);
    this.terms = {};
    this.registerCommands = registerCommandHandlers;
    props.ref_(this);
  }

  shouldComponentUpdate(nextProps: TermsProps & {children: any}) {
    return (
      ObjectTypedKeys(nextProps).some((i) => i !== 'write' && this.props[i] !== nextProps[i]) ||
      ObjectTypedKeys(this.props).some((i) => i !== 'write' && this.props[i] !== nextProps[i])
    );
  }

  onRef = (uid: string, term: Term | null) => {
    if (term) {
      this.terms[uid] = term;
    }
  };

  getTermByUid(uid: string) {
    return this.terms[uid];
  }

  getActiveTerm() {
    return this.getTermByUid(this.props.activeSession!);
  }

  onTerminal(uid: string, term: Term) {
    this.terms[uid] = term;
  }

  componentDidMount() {
    window.addEventListener('contextmenu', () => {
      const selection = window.getSelection()?.toString() ?? '';
      const {
        props: {uid}
      } = this.getActiveTerm();
      this.props.onContextMenu(uid, selection);
    });
  }

  componentDidUpdate(prevProps: TermsProps) {
    for (const uid in prevProps.sessions) {
      if (!this.props.sessions[uid]) {
        this.terms[uid].term.dispose();
        delete this.terms[uid];
      }
    }
  }

  componentWillUnmount() {
    this.props.ref_(null);
  }

  render() {
    const shift = !isMac && this.props.termGroups.length > 1;
    return (
      <div className={`${styles.termsTerms} ${shift ? styles.termsTermsShifted : styles.termsTermsNotShifted}`}>
        {this.props.customChildrenBefore}
        {this.props.termGroups.map((termGroup) => {
          const {uid} = termGroup;
          const isActive = uid === this.props.activeRootGroup;
          const props = getTermGroupProps(uid, this.props, {
            termGroup,
            terms: this.terms,
            activeSession: this.props.activeSession,
            sessions: this.props.sessions,
            scrollback: this.props.scrollback,
            backgroundColor: this.props.backgroundColor,
            foregroundColor: this.props.foregroundColor,
            borderColor: this.props.borderColor,
            selectionColor: this.props.selectionColor,
            colors: this.props.colors,
            cursorShape: this.props.cursorShape,
            cursorBlink: this.props.cursorBlink,
            cursorColor: this.props.cursorColor,
            cursorAccentColor: this.props.cursorAccentColor,
            fontSize: this.props.fontSize,
            fontFamily: this.props.fontFamily,
            uiFontFamily: this.props.uiFontFamily,
            fontWeight: this.props.fontWeight,
            fontWeightBold: this.props.fontWeightBold,
            lineHeight: this.props.lineHeight,
            letterSpacing: this.props.letterSpacing,
            padding: this.props.padding,
            bell: this.props.bell,
            bellSoundURL: this.props.bellSoundURL,
            bellSound: this.props.bellSound,
            copyOnSelect: this.props.copyOnSelect,
            modifierKeys: this.props.modifierKeys,
            onActive: this.props.onActive,
            onResize: this.props.onResize,
            onTitle: this.props.onTitle,
            onData: this.props.onData,
            onOpenSearch: this.props.onOpenSearch,
            onCloseSearch: this.props.onCloseSearch,
            onContextMenu: this.props.onContextMenu,
            quickEdit: this.props.quickEdit,
            webGLRenderer: this.props.webGLRenderer,
            webGLRendererMaxContexts: this.props.webGLRendererMaxContexts,
            webLinksActivationKey: this.props.webLinksActivationKey,
            macOptionSelectionMode: this.props.macOptionSelectionMode,
            disableLigatures: this.props.disableLigatures,
            screenReaderMode: this.props.screenReaderMode,
            windowsPty: this.props.windowsPty,
            imageSupport: this.props.imageSupport,
            isActiveRootGroup: isActive,
            parentProps: this.props
          });

          return (
            <div key={`d${uid}`} className={`${styles.termsTermGroup} ${isActive ? styles.termsTermGroupActive : ''}`}>
              <TermGroup key={uid} ref_={this.onRef} {...props} />
            </div>
          );
        })}
        {this.props.customChildren}
        <StyleSheet
          backgroundColor={this.props.backgroundColor}
          customCSS={this.props.customCSS}
          fontFamily={this.props.fontFamily}
          foregroundColor={this.props.foregroundColor}
          borderColor={this.props.borderColor}
        />
      </div>
    );
  }
}
