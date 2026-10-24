/** @file Renders terminal groups and split panes for sessions. */
import React from 'react';

import {connect} from 'react-redux';

import {CURSOR_STYLE_CONFIG_KEY} from '@shared/types/config';
import type {HyperState, HyperDispatch, TermGroupProps, TermGroupOwnProps} from '../../typings/hyper';
import {resizeTermGroup} from '../actions/term-groups';
import {decorate, getTermProps, getTermGroupProps} from '../utils/plugins';
import {getTermGroup} from '../utils/term-groups';

import SplitPane_ from './split-pane';
import Term_ from './term';

const Term = decorate(Term_, 'Term');
const SplitPane = decorate(SplitPane_, 'SplitPane');

class TermGroup_ extends React.PureComponent<TermGroupProps> {
  bound: WeakMap<(uid: string, ...args: any[]) => any, Partial<Record<string, (...args: any[]) => any>>>;
  term?: Term_ | null;
  constructor(props: TermGroupProps, context: any) {
    super(props, context);
    this.bound = new WeakMap();
  }

  bind<T extends (uid: string, ...args: any[]) => any>(
    fn: T,
    thisObj: any,
    uid: string
  ): (...args: T extends (uid: string, ..._args: infer I) => any ? I : never) => ReturnType<T> {
    let map = this.bound.get(fn);
    if (!map) {
      map = {};
      this.bound.set(fn, map);
    }

    // The first call for a uid creates its bound copy; later calls must reuse
    // it, since a stable identity is what keeps the child props unchanged.
    let bound = map[uid];
    if (!bound) {
      bound = fn.bind(thisObj, uid);
      map[uid] = bound;
    }
    // SAFETY: `bind` fixes `uid` and leaves the remaining parameters and the
    // return type untouched, which is exactly the mapped signature above. The
    // cache widens them to `any[]`, so only the read back needs restating.
    return bound as (...args: T extends (uid: string, ..._args: infer I) => any ? I : never) => ReturnType<T>;
  }

  renderSplit(groups: React.JSX.Element[]) {
    const [first, ...rest] = groups;
    if (rest.length === 0) {
      return first;
    }

    const directionValue = this.props.termGroup.direction?.toLowerCase();
    const direction: 'horizontal' | 'vertical' = directionValue === 'vertical' ? 'vertical' : 'horizontal';
    return (
      <SplitPane
        direction={direction}
        sizes={this.props.termGroup.sizes}
        onResize={this.props.onTermGroupResize}
        borderColor={this.props.borderColor}
      >
        {groups}
      </SplitPane>
    );
  }

  onTermRef = (uid: string, term: Term_ | null) => {
    this.term = term;
    this.props.ref_(uid, term);
  };

  renderTerm(uid: string) {
    const session = this.props.sessions[uid];
    // The group can outlive its session by a render while an exit is queued,
    // and there is nothing to show in that gap.
    if (!session) {
      return null;
    }
    const termRef = this.props.terms[uid];
    const props = getTermProps(uid, this.props, {
      isTermActive: uid === this.props.activeSession,
      term: termRef ? termRef.term : null,
      fitAddon: termRef ? termRef.fitAddon : null,
      searchAddon: termRef ? termRef.searchAddon : null,
      scrollback: this.props.scrollback,
      backgroundColor: this.props.backgroundColor,
      foregroundColor: this.props.foregroundColor,
      colors: this.props.colors,
      cursorBlink: this.props.cursorBlink,
      [CURSOR_STYLE_CONFIG_KEY]: this.props.cursorShape,
      cursorColor: this.props.cursorColor,
      cursorAccentColor: this.props.cursorAccentColor,
      fontSize: this.props.fontSize,
      fontFamily: this.props.fontFamily,
      uiFontFamily: this.props.uiFontFamily,
      fontSmoothing: this.props.fontSmoothing,
      fontWeight: this.props.fontWeight,
      fontWeightBold: this.props.fontWeightBold,
      lineHeight: this.props.lineHeight,
      letterSpacing: this.props.letterSpacing,
      modifierKeys: this.props.modifierKeys,
      padding: this.props.padding,
      cleared: session.cleared,
      search: session.search,
      cols: session.cols,
      rows: session.rows,
      copyOnSelect: this.props.copyOnSelect,
      bell: this.props.bell,
      bellSoundURL: this.props.bellSoundURL,
      bellSound: this.props.bellSound,
      onActive: this.bind(this.props.onActive, null, uid),
      onResize: this.bind(this.props.onResize, null, uid),
      onTitle: this.bind(this.props.onTitle, null, uid),
      onData: this.bind(this.props.onData, null, uid),
      onOpenSearch: this.bind(this.props.onOpenSearch, null, uid),
      onCloseSearch: this.bind(this.props.onCloseSearch, null, uid),
      onContextMenu: this.bind(this.props.onContextMenu, null, uid),
      borderColor: this.props.borderColor,
      selectionColor: this.props.selectionColor,
      quickEdit: this.props.quickEdit,
      webGLRenderer: this.props.webGLRenderer,
      webGLRendererMaxContexts: this.props.webGLRendererMaxContexts,
      webLinksActivationKey: this.props.webLinksActivationKey,
      macOptionSelectionMode: this.props.macOptionSelectionMode,
      disableLigatures: this.props.disableLigatures,
      screenReaderMode: this.props.screenReaderMode,
      windowsPty: this.props.windowsPty,
      imageSupport: this.props.imageSupport,
      isActiveRootGroup: this.props.isActiveRootGroup,
      uid
    });

    // This will create a new ref_ function for every render,
    // which is inefficient. Should maybe do something similar
    // to this.bind.
    return <Term ref_={this.onTermRef} key={uid} {...props} />;
  }

  render() {
    const {childGroups, termGroup} = this.props;
    if (termGroup.sessionUid) {
      return this.renderTerm(termGroup.sessionUid);
    }

    const groups = childGroups.asMutable().map((child) => {
      const props = getTermGroupProps(
        child.uid,
        this.props.parentProps,
        Object.assign({}, this.props, {termGroup: child})
      );

      return <DecoratedTermGroup key={child.uid} {...props} />;
    });

    return this.renderSplit(groups);
  }
}

const mapStateToProps = (state: HyperState, ownProps: TermGroupOwnProps) => ({
  childGroups: ownProps.termGroup.children.map((uid) => getTermGroup(state.termGroups.termGroups, uid))
});

const mapDispatchToProps = (dispatch: HyperDispatch, ownProps: TermGroupOwnProps) => ({
  onTermGroupResize(splitSizes: number[]) {
    dispatch(resizeTermGroup(ownProps.termGroup.uid, splitSizes));
  }
});

const TermGroup = connect(mapStateToProps, mapDispatchToProps, null, {forwardRef: true})(TermGroup_);

const DecoratedTermGroup = decorate(TermGroup, 'TermGroup');

export default TermGroup;

export type TermGroupConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
