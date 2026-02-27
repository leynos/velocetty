/** @file Terminal renderer component and xterm integration. */
import {clipboard, shell} from 'electron';
import React from 'react';

import Color from 'color';
import isEqual from 'lodash/isEqual';
import pickBy from 'lodash/pickBy';
import {Terminal} from 'xterm';
import type {ITerminalOptions, IDisposable} from 'xterm';
import {CanvasAddon} from 'xterm-addon-canvas';
import {FitAddon} from 'xterm-addon-fit';
import {ImageAddon} from 'xterm-addon-image';
import {LigaturesAddon} from 'xterm-addon-ligatures';
import {SearchAddon} from 'xterm-addon-search';
import type {ISearchDecorationOptions} from 'xterm-addon-search';
import {Unicode11Addon} from 'xterm-addon-unicode11';
import {WebLinksAddon} from 'xterm-addon-web-links';
import {WebglAddon} from 'xterm-addon-webgl';

import type {TermProps} from '../../typings/hyper';
import {asSessionId, type RendererFallbackReason} from '@shared/types/common';
import terms from '../terms';
import {transport} from '../transport';
import {isPaneVisible} from '../utils/pane-visibility';
import processClipboard from '../utils/paste';
import {decorate} from '../utils/plugins';
import {WebGLContextPool} from '../utils/webgl-context-pool';

import _SearchBox from './searchBox';

import 'xterm/css/xterm.css';

const SearchBox = decorate(_SearchBox, 'SearchBox');

const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].includes(navigator.platform) || process.platform === 'win32';

// map old hterm constants to xterm.js
const CURSOR_STYLES = {
  BEAM: 'bar',
  UNDERLINE: 'underline',
  BLOCK: 'block'
} as const;

const isWebgl2Supported = (() => {
  let isSupported = window.WebGL2RenderingContext ? undefined : false;
  return () => {
    if (isSupported === undefined) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', {depth: false, antialias: false});
      isSupported = gl instanceof window.WebGL2RenderingContext;
    }
    return isSupported;
  };
})();

const DEFAULT_WEBGL_MAX_CONTEXTS = 16;
const now = () => Date.now();

// Pool entries are logical slot tokens, not reusable WebGL context objects.
type WebGLPoolSlot = Readonly<{paneId: string}>;

// These module-level singletons coordinate WebGL ownership across all Term instances.
// The pool is created on first access and intentionally lives for the renderer lifetime.
let sharedWebGLContextPool: WebGLContextPool<WebGLPoolSlot> | null = null;
let sharedWebGLContextPoolMax: number | null = null;
const webGLPoolReleaseHandlers = new Map<string, () => void>();

const resolveWebGLMaxContexts = (value: number) => {
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_WEBGL_MAX_CONTEXTS;
};

const getWebGLContextPool = (maxContexts: number) => {
  const resolvedMaxContexts = resolveWebGLMaxContexts(maxContexts);

  if (!sharedWebGLContextPool) {
    sharedWebGLContextPool = new WebGLContextPool<WebGLPoolSlot>({maxContexts: resolvedMaxContexts});
    sharedWebGLContextPoolMax = resolvedMaxContexts;
    return sharedWebGLContextPool;
  }

  if (sharedWebGLContextPoolMax !== resolvedMaxContexts) {
    console.warn(
      'Changing `webGLRendererMaxContexts` at runtime recreates the shared pool and re-syncs active terminals. ' +
        `Applying ${resolvedMaxContexts}.`
    );

    sharedWebGLContextPool = new WebGLContextPool<WebGLPoolSlot>({maxContexts: resolvedMaxContexts});
    sharedWebGLContextPoolMax = resolvedMaxContexts;

    for (const releaseHandler of [...webGLPoolReleaseHandlers.values()]) {
      releaseHandler();
    }
  }

  return sharedWebGLContextPool;
};

const getTermOptions = (props: TermProps): ITerminalOptions => {
  // Set a background color only if it is opaque
  const needTransparency = Color(props.backgroundColor).alpha() < 1;
  const backgroundColor = needTransparency ? 'rgba(0,0,0,0)' : props.backgroundColor;

  return {
    macOptionIsMeta: props.modifierKeys.altIsMeta,
    scrollback: props.scrollback,
    cursorStyle: CURSOR_STYLES[props.cursorShape],
    cursorBlink: props.cursorBlink,
    fontFamily: props.fontFamily,
    fontSize: props.fontSize,
    fontWeight: props.fontWeight,
    fontWeightBold: props.fontWeightBold,
    lineHeight: props.lineHeight,
    letterSpacing: props.letterSpacing,
    allowTransparency: needTransparency,
    macOptionClickForcesSelection: props.macOptionSelectionMode === 'force',
    windowsMode: isWindows,
    ...(isWindows && props.windowsPty && {windowsPty: props.windowsPty}),
    theme: {
      foreground: props.foregroundColor,
      background: backgroundColor,
      cursor: props.cursorColor,
      cursorAccent: props.cursorAccentColor,
      selectionBackground: props.selectionColor,
      black: props.colors.black,
      red: props.colors.red,
      green: props.colors.green,
      yellow: props.colors.yellow,
      blue: props.colors.blue,
      magenta: props.colors.magenta,
      cyan: props.colors.cyan,
      white: props.colors.white,
      brightBlack: props.colors.lightBlack,
      brightRed: props.colors.lightRed,
      brightGreen: props.colors.lightGreen,
      brightYellow: props.colors.lightYellow,
      brightBlue: props.colors.lightBlue,
      brightMagenta: props.colors.lightMagenta,
      brightCyan: props.colors.lightCyan,
      brightWhite: props.colors.lightWhite
    },
    screenReaderMode: props.screenReaderMode,
    overviewRulerWidth: 20,
    allowProposedApi: true
  };
};

/** Terminal view component that wraps xterm and renderer-specific behaviour. */
export default class Term extends React.PureComponent<
  TermProps,
  {
    searchOptions: {
      caseSensitive: boolean;
      wholeWord: boolean;
      regex: boolean;
    };
    searchResults:
      | {
          resultIndex: number;
          resultCount: number;
        }
      | undefined;
  }
> {
  termRef: HTMLElement | null;
  termWrapperRef: HTMLElement | null;
  termOptions: ITerminalOptions;
  disposableListeners: IDisposable[];
  defaultBellSound: HTMLAudioElement | null;
  bellSound: HTMLAudioElement | null;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  canvasAddon: CanvasAddon | null;
  webglAddon: WebglAddon | null;
  ligaturesAddon: LigaturesAddon | null;
  static rendererTypes: Record<string, string>;
  term!: Terminal;
  resizeObserver?: ResizeObserver;
  resizeTimeout?: NodeJS.Timeout;
  visibilityFrame: number | null;
  hasWarnedAboutTransparentWebGL: boolean;
  hasWarnedAboutUnsupportedWebGL: boolean;
  webglFailureCount: number;
  webglLastFailureAt: number;
  webglCooldownMs: number;
  webglFailureThreshold: number;
  webglFailureDecayMs: number;
  webglRetryTimer: ReturnType<typeof window.setTimeout> | null;
  searchDecorations: ISearchDecorationOptions;
  state = {
    searchOptions: {
      caseSensitive: false,
      wholeWord: false,
      regex: false
    },
    searchResults: undefined
  };

  constructor(props: TermProps) {
    super(props);
    props.ref_(props.uid, this);
    this.termRef = null;
    this.termWrapperRef = null;
    this.termOptions = {};
    this.disposableListeners = [];
    this.defaultBellSound = null;
    this.bellSound = null;
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.canvasAddon = null;
    this.webglAddon = null;
    this.ligaturesAddon = null;
    this.visibilityFrame = null;
    this.hasWarnedAboutTransparentWebGL = false;
    this.hasWarnedAboutUnsupportedWebGL = false;
    this.webglFailureCount = 0;
    this.webglLastFailureAt = 0;
    this.webglCooldownMs = 500;
    this.webglFailureThreshold = 3;
    this.webglFailureDecayMs = 15_000;
    this.webglRetryTimer = null;
    this.searchDecorations = {
      activeMatchColorOverviewRuler: Color(this.props.cursorColor).hex(),
      matchOverviewRuler: Color(this.props.borderColor).hex(),
      activeMatchBackground: Color(this.props.cursorColor).hex(),
      activeMatchBorder: Color(this.props.cursorColor).hex(),
      matchBorder: Color(this.props.cursorColor).hex()
    };
  }

  // The main process shows this in the About dialog
  static reportRenderer(uid: string, type: string, reason?: RendererFallbackReason) {
    const rendererTypes = Term.rendererTypes || {};
    const hasTypeChanged = rendererTypes[uid] !== type;
    rendererTypes[uid] = type;
    Term.rendererTypes = rendererTypes;

    if (!hasTypeChanged && !reason) {
      return;
    }

    if (reason) {
      transport.emit('info renderer', {uid: asSessionId(uid), type, reason});
      return;
    }

    transport.emit('info renderer', {uid: asSessionId(uid), type});
  }

  componentDidMount() {
    const {props} = this;

    this.termOptions = getTermOptions(props);
    this.term = props.term || new Terminal(this.termOptions);
    this.defaultBellSound = new Audio(
      // Source: https://freesound.org/people/altemark/sounds/45759/
      // This sound is released under the Creative Commons Attribution 3.0 Unported
      // (CC BY 3.0) license. It was created by 'altemark'. No modifications have been
      // made, apart from the conversion to base64.
      'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjMyLjEwNAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
    );
    this.setBellSound(props.bell, props.bellSound);

    // The parent element for the terminal is attached and removed manually so
    // that we can preserve it across mounts and unmounts of the component
    this.termRef = props.term?.element?.parentElement ?? document.createElement('div');
    this.termRef.className = 'term_fit term_term';

    this.termWrapperRef?.appendChild(this.termRef);

    if (!props.term) {
      const shallActivateWebLink = (event: MouseEvent): boolean => {
        if (!event) return false;
        return props.webLinksActivationKey ? event[`${props.webLinksActivationKey}Key`] : true;
      };

      // eslint-disable-next-line @typescript-eslint/unbound-method
      this.term.attachCustomKeyEventHandler(this.keyboardHandler);
      this.term.loadAddon(this.fitAddon);
      this.term.loadAddon(this.searchAddon);
      this.term.loadAddon(
        new WebLinksAddon((event, uri) => {
          if (shallActivateWebLink(event)) void shell.openExternal(uri);
        })
      );
      this.term.open(this.termRef);

      this.term.loadAddon(new Unicode11Addon());
      this.term.unicode.activeVersion = '11';

      if (props.imageSupport) {
        this.term.loadAddon(new ImageAddon());
      }
    } else {
      // get the cached plugins
      this.fitAddon = props.fitAddon!;
      this.searchAddon = props.searchAddon!;
    }

    if (this.term.element) {
      this.term.element.style.padding = props.padding;
    }

    this.fitAddon.fit();
    this.syncRendererForVisibility();

    if (this.props.isTermActive) {
      this.term.focus();
    }

    if (props.onTitle) {
      this.disposableListeners.push(this.term.onTitleChange(props.onTitle));
    }

    if (props.onActive) {
      this.term.textarea?.addEventListener('focus', props.onActive);
      this.disposableListeners.push({
        dispose: () => this.term.textarea?.removeEventListener('focus', this.props.onActive)
      });
    }

    if (props.onData) {
      this.disposableListeners.push(this.term.onData(props.onData));
    }

    this.term.onBell(() => {
      this.ringBell();
    });

    if (props.onResize) {
      this.disposableListeners.push(
        this.term.onResize(({cols, rows}) => {
          props.onResize(cols, rows);
        })
      );

      // the row and col of init session is null, so reize the node-pty
      props.onResize(this.term.cols, this.term.rows);
    }

    if (props.onCursorMove) {
      this.disposableListeners.push(
        this.term.onCursorMove(() => {
          const cursorFrame = {
            x: this.term.buffer.active.cursorX * (this.term as any)._core._renderService.dimensions.actualCellWidth,
            y: this.term.buffer.active.cursorY * (this.term as any)._core._renderService.dimensions.actualCellHeight,
            width: (this.term as any)._core._renderService.dimensions.actualCellWidth,
            height: (this.term as any)._core._renderService.dimensions.actualCellHeight,
            col: this.term.buffer.active.cursorX,
            row: this.term.buffer.active.cursorY
          };
          props.onCursorMove?.(cursorFrame);
        })
      );
    }

    this.disposableListeners.push(
      this.searchAddon.onDidChangeResults((results) => {
        this.setState((state) => ({
          ...state,
          searchResults: results
        }));
      })
    );

    window.addEventListener('paste', this.onWindowPaste, {
      capture: true
    });
    window.addEventListener('resize', this.scheduleRendererVisibilitySync, {passive: true});
    window.addEventListener('scroll', this.scheduleRendererVisibilitySync, true);
    this.scheduleRendererVisibilitySync();

    terms[this.props.uid] = this;
  }

  getTermDocument() {
    console.warn(
      'The underlying terminal engine of Hyper no longer ' +
        'uses iframes with individual `document` objects for each ' +
        'terminal instance. This method call is retained for ' +
        "backwards compatibility reasons. It's ok to attach directly" +
        'to the `document` object of the main `window`.'
    );
    return document;
  }

  // intercepting paste event for any necessary processing of
  // clipboard data, if result is falsy, paste event continues
  onWindowPaste = (e: Event) => {
    if (!this.props.isTermActive) return;

    const processed = processClipboard();
    if (processed) {
      e.preventDefault();
      e.stopPropagation();
      this.term.paste(processed);
    }
  };

  onMouseUp = (e: React.MouseEvent) => {
    if (this.props.quickEdit && e.button === 2) {
      if (this.term.hasSelection()) {
        clipboard.writeText(this.term.getSelection());
        this.term.clearSelection();
      } else {
        document.execCommand('paste');
      }
    } else if (this.props.copyOnSelect && this.term.hasSelection()) {
      clipboard.writeText(this.term.getSelection());
    }
  };

  write(data: string | Uint8Array) {
    this.term.write(data);
  }

  focus = () => {
    this.term.focus();
  };

  clear() {
    this.term.clear();
  }

  reset() {
    this.term.reset();
  }

  searchNext = (searchTerm: string) => {
    this.searchAddon.findNext(searchTerm, {
      ...this.state.searchOptions,
      decorations: this.searchDecorations
    });
  };

  searchPrevious = (searchTerm: string) => {
    this.searchAddon.findPrevious(searchTerm, {
      ...this.state.searchOptions,
      decorations: this.searchDecorations
    });
  };

  closeSearchBox = () => {
    this.props.onCloseSearch();
    this.searchAddon.clearDecorations();
    this.searchAddon.clearActiveDecoration();
    this.setState((state) => ({
      ...state,
      searchResults: undefined
    }));
    this.term.focus();
  };

  resize(cols: number, rows: number) {
    this.term.resize(cols, rows);
  }

  selectAll() {
    this.term.selectAll();
  }

  fitResize() {
    if (!this.termWrapperRef) {
      return;
    }
    this.fitAddon.fit();
  }

  keyboardHandler(e: any) {
    // Has Mousetrap flagged this event as a command?
    return !e.catched;
  }

  setBellSound(bell: 'SOUND' | false, sound: string | null) {
    if (bell && bell.toUpperCase() === 'SOUND') {
      this.bellSound = sound ? new Audio(sound) : this.defaultBellSound;
    } else {
      this.bellSound = null;
    }
  }

  ringBell() {
    void this.bellSound?.play();
  }

  private recordWebGLFailure(timestamp = now()) {
    this.webglFailureCount += 1;
    this.webglLastFailureAt = timestamp;
  }

  private clearRendererRetryTimer() {
    if (this.webglRetryTimer === null) {
      return;
    }

    clearTimeout(this.webglRetryTimer);
    this.webglRetryTimer = null;
  }

  private getWebGLRetryDelayMs(currentTime = now()) {
    if (this.webglFailureCount === 0 || this.webglLastFailureAt === 0) {
      return this.webglCooldownMs;
    }

    if (this.webglFailureCount > this.webglFailureThreshold) {
      return Math.max(this.webglCooldownMs, this.webglLastFailureAt + this.webglFailureDecayMs - currentTime);
    }

    return Math.max(this.webglCooldownMs, this.webglLastFailureAt + this.webglCooldownMs - currentTime);
  }

  onWebGLContextLoss = () => {
    console.warn('WebGL context lost. Falling back to canvas-based rendering.');
    this.recordWebGLFailure();
    this.detachWebGLRenderer();
    this.ensureCanvasRenderer('context-loss');
    this.scheduleRendererVisibilitySync();
    this.scheduleDeterministicRendererRetry();
  };

  onWebGLEvicted = () => {
    this.recordWebGLFailure();
    this.detachWebGLRenderer();
    this.ensureCanvasRenderer('pool-evicted');
    this.scheduleDeterministicRendererRetry();
  };

  scheduleDeterministicRendererRetry = () => {
    if (this.webglRetryTimer !== null) {
      return;
    }

    this.webglRetryTimer = window.setTimeout(() => {
      this.webglRetryTimer = null;
      this.syncRendererForVisibility();
    }, this.getWebGLRetryDelayMs());
  };

  scheduleRendererVisibilitySync = () => {
    if (this.visibilityFrame !== null) {
      return;
    }

    this.visibilityFrame = window.requestAnimationFrame(() => {
      this.visibilityFrame = null;
      this.syncRendererForVisibility();
    });
  };

  private warnAboutTransparentWebGL() {
    if (!this.hasWarnedAboutTransparentWebGL) {
      console.warn(
        'WebGL Renderer has been disabled since it does not support transparent backgrounds yet. ' +
          'Falling back to canvas-based rendering.'
      );
      this.hasWarnedAboutTransparentWebGL = true;
    }
  }

  private warnAboutUnsupportedWebGL() {
    if (!this.hasWarnedAboutUnsupportedWebGL) {
      console.warn('WebGL2 is not supported on your machine. Falling back to canvas-based rendering.');
      this.hasWarnedAboutUnsupportedWebGL = true;
    }
  }

  private hasWebGLFailureCooldown(currentTime = now()) {
    if (this.webglFailureCount === 0) {
      return false;
    }

    if (this.webglLastFailureAt > 0 && currentTime - this.webglLastFailureAt >= this.webglFailureDecayMs) {
      this.webglFailureCount = 0;
      this.webglLastFailureAt = 0;
      return false;
    }

    if (this.webglFailureCount > this.webglFailureThreshold) {
      return true;
    }

    return currentTime < this.webglLastFailureAt + this.webglCooldownMs;
  }

  private markWebGLInitSuccess() {
    this.webglFailureCount = 0;
    this.webglLastFailureAt = 0;
  }

  canUseWebGLRenderer(hasFailureCooldown = this.hasWebGLFailureCooldown()) {
    if (!this.props.webGLRenderer) {
      return false;
    }

    const needTransparency = Color(this.props.backgroundColor).alpha() < 1;
    if (needTransparency) {
      this.warnAboutTransparentWebGL();
      return false;
    }

    if (!isWebgl2Supported()) {
      this.warnAboutUnsupportedWebGL();
      return false;
    }

    if (hasFailureCooldown) {
      return false;
    }

    return true;
  }

  private isCompletelyOutsideViewport(bounds: DOMRect, viewportWidth: number, viewportHeight: number) {
    return bounds.right <= 0 || bounds.bottom <= 0 || bounds.left >= viewportWidth || bounds.top >= viewportHeight;
  }

  isPaneOccluded(bounds: DOMRect) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (this.isCompletelyOutsideViewport(bounds, viewportWidth, viewportHeight)) {
      return true;
    }

    const sampleX = Math.max(0, Math.min(viewportWidth - 1, bounds.left + bounds.width / 2));
    const sampleY = Math.max(0, Math.min(viewportHeight - 1, bounds.top + bounds.height / 2));
    const topElement = document.elementFromPoint(sampleX, sampleY);

    if (!topElement) {
      return false;
    }

    return this.termWrapperRef ? !this.termWrapperRef.contains(topElement) : true;
  }

  isPaneVisible() {
    if (!this.termWrapperRef) {
      return false;
    }

    const bounds = this.termWrapperRef.getBoundingClientRect();
    return isPaneVisible({
      isActiveTab: this.props.isActiveRootGroup,
      bounds: {width: bounds.width, height: bounds.height},
      isOccluded: this.isPaneOccluded(bounds)
    });
  }

  ensureCanvasRenderer(reason?: RendererFallbackReason) {
    if (!this.canvasAddon) {
      this.canvasAddon = new CanvasAddon();
      this.term.loadAddon(this.canvasAddon);
    }

    if (this.props.disableLigatures) {
      this.ligaturesAddon?.dispose();
      this.ligaturesAddon = null;
    } else if (!this.ligaturesAddon) {
      this.ligaturesAddon = new LigaturesAddon();
      this.term.loadAddon(this.ligaturesAddon);
    }

    Term.reportRenderer(this.props.uid, 'Canvas', reason);
  }

  detachWebGLRenderer() {
    webGLPoolReleaseHandlers.delete(this.props.uid);
    sharedWebGLContextPool?.release(this.props.uid);

    if (this.webglAddon) {
      this.webglAddon.dispose();
      this.webglAddon = null;
    }
  }

  ensureWebGLRenderer(webGLContextPool = getWebGLContextPool(this.props.webGLRendererMaxContexts)) {
    try {
      // Acquire/release manages logical slot ownership only. Each pane still
      // owns its own WebglAddon instance and underlying browser WebGL context.
      webGLContextPool.acquire(
        this.props.uid,
        () => ({paneId: this.props.uid}),
        (_context, paneId) => {
          const releaseHandler = webGLPoolReleaseHandlers.get(paneId);
          releaseHandler?.();
        }
      );
      webGLPoolReleaseHandlers.set(this.props.uid, this.onWebGLEvicted);

      if (!this.webglAddon) {
        this.webglAddon = new WebglAddon();
        this.term.loadAddon(this.webglAddon);
        this.webglAddon.onContextLoss(this.onWebGLContextLoss);
      }

      if (this.canvasAddon) {
        this.canvasAddon.dispose();
        this.canvasAddon = null;
      }

      if (this.ligaturesAddon) {
        this.ligaturesAddon.dispose();
        this.ligaturesAddon = null;
      }

      this.markWebGLInitSuccess();
      this.clearRendererRetryTimer();
      Term.reportRenderer(this.props.uid, 'WebGL');
    } catch (error) {
      console.warn('WebGL renderer initialization failed. Falling back to canvas-based rendering.', error);
      this.recordWebGLFailure();
      this.detachWebGLRenderer();
      this.ensureCanvasRenderer('webgl-init-failed');
      this.scheduleDeterministicRendererRetry();
    }
  }

  syncRendererForVisibility() {
    if (!this.termRef) {
      return;
    }

    const paneVisible = this.isPaneVisible();
    const hasFailureCooldown = this.hasWebGLFailureCooldown();
    if (!paneVisible || !this.canUseWebGLRenderer(hasFailureCooldown)) {
      this.detachWebGLRenderer();
      this.ensureCanvasRenderer();
      if (paneVisible && hasFailureCooldown) {
        this.scheduleDeterministicRendererRetry();
      }
      return;
    }

    const webGLContextPool = getWebGLContextPool(this.props.webGLRendererMaxContexts);
    this.ensureWebGLRenderer(webGLContextPool);
  }

  private hasFontPropsChanged(prevProps: TermProps): boolean {
    return (
      this.props.fontSize !== prevProps.fontSize ||
      this.props.fontFamily !== prevProps.fontFamily ||
      this.props.lineHeight !== prevProps.lineHeight ||
      this.props.letterSpacing !== prevProps.letterSpacing
    );
  }

  private hasRendererPropsChanged(prevProps: TermProps): boolean {
    return (
      prevProps.isActiveRootGroup !== this.props.isActiveRootGroup ||
      prevProps.webGLRenderer !== this.props.webGLRenderer ||
      prevProps.webGLRendererMaxContexts !== this.props.webGLRendererMaxContexts ||
      prevProps.backgroundColor !== this.props.backgroundColor ||
      prevProps.disableLigatures !== this.props.disableLigatures
    );
  }

  componentDidUpdate(prevProps: TermProps) {
    if (!prevProps.cleared && this.props.cleared) {
      this.clear();
    }

    const nextTermOptions = getTermOptions(this.props);

    if (prevProps.bell !== this.props.bell || prevProps.bellSound !== this.props.bellSound) {
      this.setBellSound(this.props.bell, this.props.bellSound);
    }

    if (prevProps.search && !this.props.search) {
      this.closeSearchBox();
    }

    // Update only options that have changed.
    this.term.options = pickBy(
      nextTermOptions,
      (value, key) => !isEqual(this.termOptions[key as keyof ITerminalOptions], value)
    );

    this.termOptions = nextTermOptions;

    if (this.term.element) {
      this.term.element.style.padding = this.props.padding;
    }

    if (this.hasFontPropsChanged(prevProps)) {
      // resize to fit the container
      this.fitResize();
    }

    if (prevProps.rows !== this.props.rows || prevProps.cols !== this.props.cols) {
      this.resize(this.props.cols!, this.props.rows!);
    }

    if (this.hasRendererPropsChanged(prevProps)) {
      this.scheduleRendererVisibilitySync();
    }
  }

  onTermWrapperRef = (component: HTMLElement | null) => {
    this.termWrapperRef = component;

    if (component) {
      this.resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
          this.fitResize();
          this.scheduleRendererVisibilitySync();
        }, 500);
      });
      this.resizeObserver.observe(component);
    } else {
      this.resizeObserver?.disconnect();
    }
  };

  componentWillUnmount() {
    terms[this.props.uid] = null;
    const termWrapper = this.termWrapperRef;
    const termElement = this.termRef;
    if (termWrapper && termElement) {
      termWrapper.removeChild(termElement);
    }
    this.props.ref_(this.props.uid, null);

    // to clean up the terminal, we remove the listeners
    // instead of invoking `destroy`, since it will make the
    // term insta un-attachable in the future (which we need
    // to do in case of splitting, see `componentDidMount`
    this.disposableListeners.forEach((handler) => handler.dispose());
    this.disposableListeners = [];

    this.detachWebGLRenderer();
    this.canvasAddon?.dispose();
    this.canvasAddon = null;
    this.ligaturesAddon?.dispose();
    this.ligaturesAddon = null;
    if (this.visibilityFrame !== null) {
      window.cancelAnimationFrame(this.visibilityFrame);
      this.visibilityFrame = null;
    }
    this.clearRendererRetryTimer();
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeTimeout);
    window.removeEventListener('resize', this.scheduleRendererVisibilitySync);
    window.removeEventListener('scroll', this.scheduleRendererVisibilitySync, true);

    window.removeEventListener('paste', this.onWindowPaste, {
      capture: true
    });
  }

  render() {
    return (
      <div className={`term_fit ${this.props.isTermActive ? 'term_active' : ''}`} onMouseUp={this.onMouseUp}>
        {this.props.customChildrenBefore}
        <div ref={this.onTermWrapperRef} className="term_fit term_wrapper" />
        {this.props.customChildren}
        {this.props.search ? (
          <SearchBox
            next={this.searchNext}
            prev={this.searchPrevious}
            close={this.closeSearchBox}
            caseSensitive={this.state.searchOptions.caseSensitive}
            wholeWord={this.state.searchOptions.wholeWord}
            regex={this.state.searchOptions.regex}
            results={this.state.searchResults}
            toggleCaseSensitive={() =>
              this.setState({
                ...this.state,
                searchOptions: {...this.state.searchOptions, caseSensitive: !this.state.searchOptions.caseSensitive}
              })
            }
            toggleWholeWord={() =>
              this.setState({
                ...this.state,
                searchOptions: {...this.state.searchOptions, wholeWord: !this.state.searchOptions.wholeWord}
              })
            }
            toggleRegex={() =>
              this.setState({
                ...this.state,
                searchOptions: {...this.state.searchOptions, regex: !this.state.searchOptions.regex}
              })
            }
            selectionColor={this.props.selectionColor}
            backgroundColor={this.props.backgroundColor}
            foregroundColor={this.props.foregroundColor}
            borderColor={this.props.borderColor}
            font={this.props.uiFontFamily}
          />
        ) : null}
        <style jsx={true} global={true}>{`
          .term_fit {
            display: block;
            width: 100%;
            height: 100%;
          }

          .term_wrapper {
            /* TODO: decide whether to keep this or not based on understanding what xterm-selection is for */
            overflow: hidden;
          }
        `}</style>
      </div>
    );
  }
}
