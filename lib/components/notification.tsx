/**
 * @file Renders in-app notification indicators and dismissal behaviour.
 * Handles timer-based auto-dismiss, transition hooks, and custom slot content
 * for the renderer notification bar.
 */
// biome-ignore lint/style/useImportType: React value is required for the current JSX runtime.
import React, {forwardRef, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {isFunction, isNumber} from '@shared/types/guards';

import type {NotificationProps, TimerSeam} from '../../typings/hyper';

type NotificationRef = React.ForwardedRef<HTMLDivElement>;

/**
 * Hands a node to whichever ref form React supplied.
 *
 * Forwarded refs arrive either as a callback or as a mutable object, and the
 * two are assigned differently. Doing the test once here keeps every caller
 * from repeating it, and lets a null `ref` mean "nothing to do" rather than
 * another branch at each call site.
 */
const assignRef = (ref: NotificationRef, element: HTMLDivElement | null): void => {
  if (!ref) {
    return;
  }
  if (isFunction(ref)) {
    ref(element);
    return;
  }
  ref.current = element;
};

/**
 * Decides whether a `transitionend` event is the one this component owns.
 *
 * Transition events bubble from descendants, and every property fires its own
 * event, so only the opacity transition on the notification's own element
 * marks the fade-out as finished. Dismissal is checked last because it is the
 * cheaper test and it changes between renders.
 */
const isOpacityTransitionEnd = (
  event: TransitionEvent,
  transitionNode: HTMLDivElement | null,
  isDismissing: boolean
): boolean => event.target === transitionNode && event.propertyName === 'opacity' && isDismissing;

/** A ref cell, named structurally so these helpers need no React import. */
type RefCell<T> = {current: T};

/** Stops the auto-dismiss countdown when one is running. */
const clearDismissTimer = (
  dismissTimer: RefCell<ReturnType<TimerSeam['setTimeout']> | null>,
  clearTimeout: TimerSeam['clearTimeout']
): void => {
  if (dismissTimer.current !== null) {
    clearTimeout(dismissTimer.current);
  }
};

/** Removes the active transition listener, leaving the recorded refs intact. */
const detachTransitionListener = (
  transitionNode: RefCell<HTMLDivElement | null>,
  transitionHandler: RefCell<((event: TransitionEvent) => void) | null>
): void => {
  if (transitionNode.current && transitionHandler.current) {
    transitionNode.current.removeEventListener('transitionend', transitionHandler.current);
  }
};

const useNotification = (props: NotificationProps, ref: NotificationRef, timer?: TimerSeam) => {
  const {backgroundColor, dismissAfter, onDismiss, text} = props;
  const dismissTimer = useRef<ReturnType<TimerSeam['setTimeout']> | null>(null);
  const dismissingRef = useRef(false);
  const transitionHandler = useRef<((event: TransitionEvent) => void) | null>(null);
  const transitionNode = useRef<HTMLDivElement | null>(null);
  const [dismissing, setDismissing] = useState(false);

  // Use injected timer seam or fall back to globals (memoized to avoid effect re-runs)
  const timerSeam = useMemo(
    () => timer ?? {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout},
    [timer]
  );
  const {setTimeout, clearTimeout} = timerSeam;

  const handleDismiss = useCallback(() => {
    dismissingRef.current = true;
    setDismissing(true);
  }, []);

  const onElement = useCallback(
    (el: HTMLDivElement | null) => {
      detachTransitionListener(transitionNode, transitionHandler);

      if (!el) {
        assignRef(ref, null);
        return;
      }

      const handler = (event: TransitionEvent) => {
        if (isOpacityTransitionEnd(event, transitionNode.current, dismissingRef.current)) {
          onDismiss();
        }
      };
      transitionHandler.current = handler;
      transitionNode.current = el;
      el.addEventListener('transitionend', handler);
      if (backgroundColor) {
        el.style.setProperty('background-color', backgroundColor, 'important');
      }
      assignRef(ref, el);
    },
    [backgroundColor, onDismiss, ref]
  );

  const setDismissTimer = useCallback(() => {
    if (isNumber(dismissAfter)) {
      dismissTimer.current = setTimeout(() => {
        handleDismiss();
      }, dismissAfter);
    }
  }, [dismissAfter, handleDismiss, setTimeout]);

  const resetDismissTimer = useCallback(() => {
    clearDismissTimer(dismissTimer, clearTimeout);
    setDismissTimer();
  }, [clearTimeout, setDismissTimer]);

  useEffect(() => {
    // if we have a timer going and the notification text
    // changed we reset the timer
    resetDismissTimer();
    dismissingRef.current = false;
    setDismissing(false);
  }, [resetDismissTimer, text]);

  useEffect(() => {
    return () => {
      clearDismissTimer(dismissTimer, clearTimeout);
      detachTransitionListener(transitionNode, transitionHandler);
      transitionNode.current = null;
      transitionHandler.current = null;
    };
  }, [clearTimeout]);

  return {
    handleDismiss,
    onElement,
    opacity: dismissing ? 0 : 1
  };
};

const Notification = forwardRef(function Notification(
  props: React.PropsWithChildren<NotificationProps>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const {handleDismiss, onElement, opacity} = useNotification(props, ref, props.timer);
  const {backgroundColor, color} = props;
  return (
    <div
      ref={onElement}
      style={{opacity, backgroundColor, color}}
      className="inline-block cursor-default select-none bg-white/20 px-3.5 py-2 ml-2.5 transition-opacity duration-150 text-white text-xs font-sans notification_indicator"
      data-testid="notification-indicator"
    >
      {props.customChildrenBefore}
      {props.children || props.text}
      {props.userDismissable ? (
        <button
          type="button"
          className="relative left-1 cursor-pointer font-semibold text-current transition-[font-weight] duration-100 ease-in-out hover:font-black focus:font-black"
          onClick={handleDismiss}
          style={{color: props.userDismissColor}}
        >
          [x]
        </button>
      ) : null}
      {props.customChildren}
    </div>
  );
});

Notification.displayName = 'Notification';

export default Notification;
