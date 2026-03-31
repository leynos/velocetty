/** @file Restart-required indicator component for settings UI.
 *
 * Displays a visual indicator next to settings that require an application
 * restart to take effect. Also provides inline warning when user modifies
 * such a setting.
 */
// biome-ignore lint/style/useImportType: React value is required for the current JSX runtime.
import React, {useMemo} from 'react';

import {keyRequiresRestart, getKeyReloadClassification} from '@shared/constants/config-reloadability';

/** Props for the RestartRequiredIndicator component. */
export type RestartRequiredIndicatorProps = {
  /** The configuration key this indicator is for. */
  configKey: string;
  /** Optional custom tooltip text. */
  tooltip?: string;
  /** Whether to show the indicator even if the key is live-reloadable. */
  forceShow?: boolean;
  /** Additional CSS class names. */
  className?: string;
};

/**
 * Indicator component that displays when a setting requires restart.
 *
 * @example
 * ```tsx
 * <label>
 *   Font Size
 *   <RestartRequiredIndicator configKey="fontSize" />
 * </label>
 * ```
 */
export const RestartRequiredIndicator: React.FC<RestartRequiredIndicatorProps> = ({
  configKey,
  tooltip,
  forceShow = false,
  className = ''
}) => {
  const requiresRestart = useMemo(() => {
    return forceShow || keyRequiresRestart(configKey);
  }, [configKey, forceShow]);

  if (!requiresRestart) {
    return null;
  }

  const defaultTooltip = `Changing this setting requires a restart to take effect.`;

  return (
    <span
      className={`restart-required-indicator ${className}`}
      title={tooltip ?? defaultTooltip}
      aria-label="Requires restart"
      role="img"
    >
      ⟳
      <style jsx={true}>{`
        .restart-required-indicator {
          display: inline-flex;
          align-items: center;
          margin-left: 4px;
          color: #f59e0b; /* amber-500 */
          font-size: 0.875em;
          cursor: help;
        }
      `}</style>
    </span>
  );
};

/** Props for the InlineRestartWarning component. */
export type InlineRestartWarningProps = {
  /** The configuration key that was changed. */
  configKey: string;
  /** Whether to show the warning. */
  show?: boolean;
  /** Custom message to display. */
  message?: string;
};

/**
 * Inline warning displayed when user modifies a non-reloadable setting.
 *
 * @example
 * ```tsx
 * <InlineRestartWarning configKey="shell" show={hasChanged} />
 * ```
 */
export const InlineRestartWarning: React.FC<InlineRestartWarningProps> = ({configKey, show = false, message}) => {
  const classification = useMemo(() => getKeyReloadClassification(configKey), [configKey]);

  if (!show || classification !== 'restart') {
    return null;
  }

  return (
    <div className="inline-restart-warning" role="alert">
      {message ?? 'This change will take effect after restarting the application.'}
      <style jsx={true}>{`
        .inline-restart-warning {
          margin-top: 4px;
          padding: 8px 12px;
          background-color: rgba(245, 158, 11, 0.1); /* amber-500 at 10% */
          border-left: 3px solid #f59e0b; /* amber-500 */
          border-radius: 0 4px 4px 0;
          font-size: 0.875em;
          color: #d97706; /* amber-600 */
        }
      `}</style>
    </div>
  );
};

/** Props for the ConfigReloadBadge component. */
export type ConfigReloadBadgeProps = {
  /** Whether to show the badge (when there are pending restart-required changes). */
  hasPendingChanges: boolean;
  /** The number of pending changes (optional). */
  pendingCount?: number;
  /** Callback when the badge is clicked (e.g., to show details). */
  onClick?: () => void;
};

/**
 * Badge component indicating pending configuration changes requiring restart.
 *
 * @example
 * ```tsx
 * <ConfigReloadBadge hasPendingChanges={true} pendingCount={2} onClick={showDetails} />
 * ```
 */
export const ConfigReloadBadge: React.FC<ConfigReloadBadgeProps> = ({hasPendingChanges, pendingCount, onClick}) => {
  if (!hasPendingChanges) {
    return null;
  }

  const content = (
    <>
      <span className="badge-icon">⟳</span>
      <span className="badge-text">
        Restart required
        {pendingCount !== undefined && pendingCount > 0 && ` (${pendingCount})`}
      </span>
    </>
  );

  // Render as non-interactive element when no onClick handler provided
  if (!onClick) {
    return (
      <output className="config-reload-badge" aria-label="Configuration changes require restart">
        {content}
      </output>
    );
  }

  return (
    <button
      type="button"
      className="config-reload-badge"
      onClick={onClick}
      title="Configuration changes require restart"
    >
      {content}
      <style jsx={true}>{`
        .config-reload-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          background-color: #f59e0b; /* amber-500 */
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 0.8125em;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }

        .config-reload-badge:hover {
          background-color: #d97706; /* amber-600 */
        }

        .config-reload-badge:focus {
          outline: 2px solid #fbbf24; /* amber-400 */
          outline-offset: 2px;
        }

        .badge-icon {
          font-size: 1em;
        }

        .badge-text {
          white-space: nowrap;
        }
      `}</style>
    </button>
  );
};

/** Props for the LiveReloadIndicator component. */
export type LiveReloadIndicatorProps = {
  /** The configuration key this indicator is for. */
  configKey: string;
  /** Whether to show the indicator. */
  show?: boolean;
};

/**
 * Indicator component showing that a setting can be live-reloaded.
 *
 * This is optional UI sugar to indicate which settings apply immediately.
 *
 * @example
 * ```tsx
 * <label>
 *   Font Size
 *   <LiveReloadIndicator configKey="fontSize" />
 * </label>
 * ```
 */
export const LiveReloadIndicator: React.FC<LiveReloadIndicatorProps> = ({configKey, show = true}) => {
  const classification = useMemo(() => getKeyReloadClassification(configKey), [configKey]);

  if (!show || classification !== 'live') {
    return null;
  }

  return (
    <span
      className="live-reload-indicator"
      title="This setting can be changed without restarting"
      aria-label="Live reloadable"
      role="img"
    >
      ⚡
      <style jsx={true}>{`
        .live-reload-indicator {
          display: inline-flex;
          align-items: center;
          margin-left: 4px;
          color: #10b981; /* emerald-500 */
          font-size: 0.875em;
          cursor: help;
        }
      `}</style>
    </span>
  );
};
