/**
 * @file Renders in-app notification indicators and dismissal behaviour.
 * Handles timer-based auto-dismiss, transition hooks, and custom slot content
 * for the renderer notification bar.
 */
// biome-ignore lint/style/useImportType: React value is required for the current JSX runtime.
import React, {forwardRef, useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {NotificationProps, TimerSeam} from '../../typings/hyper';

const useNotification = (props: NotificationProps, ref: React.ForwardedRef<HTMLDivElement>, timer?: TimerSeam) => {
  const {backgroundColor, dismissAfter, onDismiss, text} = props;
  const dismissTimer = useRef<NodeJS.Timeout | undefined>(undefined);
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
    setDismissing(true);
  }, []);

  const onElement = useCallback(
    (el: HTMLDivElement | null) => {
      if (transitionNode.current && transitionHandler.current) {
        transitionNode.current.removeEventListener('transitionend', transitionHandler.current);
      }

      if (el) {
        const handler = (event: TransitionEvent) => {
          if (event.target !== transitionNode.current || event.propertyName !== 'opacity') {
            return;
          }

          if (dismissingRef.current) {
            onDismiss();
          }
        };
        transitionHandler.current = handler;
        transitionNode.current = el;
        el.addEventListener('transitionend', handler);
        if (backgroundColor) {
          el.style.setProperty('background-color', backgroundColor, 'important');
        }

        if (ref) {
          if (typeof ref === 'function') ref(el);
          else ref.current = el;
        }
      } else if (ref) {
        if (typeof ref === 'function') ref(null);
        else ref.current = null;
      }
    },
    [backgroundColor, onDismiss, ref]
  );

  const setDismissTimer = useCallback(() => {
    if (typeof dismissAfter === 'number') {
      dismissTimer.current = setTimeout(() => {
        handleDismiss();
      }, dismissAfter);
    }
  }, [dismissAfter, handleDismiss, setTimeout]);

  const resetDismissTimer = useCallback(() => {
    clearTimeout(dismissTimer.current);
    setDismissTimer();
  }, [clearTimeout, setDismissTimer]);

  useEffect(() => {
    // if we have a timer going and the notification text
    // changed we reset the timer
    resetDismissTimer();
    setDismissing(false);
  }, [resetDismissTimer, text]);

  useEffect(() => {
    dismissingRef.current = dismissing;
  }, [dismissing]);

  useEffect(() => {
    return () => {
      clearTimeout(dismissTimer.current);
      if (transitionNode.current && transitionHandler.current) {
        transitionNode.current.removeEventListener('transitionend', transitionHandler.current);
      }
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
