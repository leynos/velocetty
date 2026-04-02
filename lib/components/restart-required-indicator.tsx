/** @file Restart-required indicator component for settings UI.
 *
 * Displays a visual indicator next to settings that require an application
 * restart to take effect. Also provides inline warning when user modifies
 * such a setting.
 *
 * These are pure/presentational components: callers should use
 * `useConfigReloadability(configKey)` and pass the resulting
 * `requiresRestart` and `classification` values as props.
 */
// biome-ignore lint/style/useImportType: React value is required for the current JSX runtime.
import React from 'react';

import type {ConfigReloadClassification} from '@shared/types/config';

/** Props for the RestartRequiredIndicator component. */
export type RestartRequiredIndicatorProps = {
  /** Whether the setting requires restart. */
  requiresRestart: boolean;
  /** Tooltip text for the indicator. */
  tooltip: string;
  /** Accessible label for the indicator. */
  ariaLabel: string;
  /** Override content for the indicator (defaults to a restart glyph if omitted). */
  children?: React.ReactNode;
  /** Additional CSS class names. */
  className?: string;
};

/**
 * Indicator component that displays when a setting requires restart.
 *
 * @example
 * ```tsx
 * const { requiresRestart } = useConfigReloadability({ configKey: 'fontSize' });
 *
 * <label>
 *   Font Size
 *   <RestartRequiredIndicator
 *     requiresRestart={requiresRestart}
 *     tooltip="Changing this setting requires a restart to take effect."
 *     ariaLabel="Requires restart"
 *   />
 * </label>
 * ```
 */
export const RestartRequiredIndicator: React.FC<RestartRequiredIndicatorProps> = ({
  requiresRestart,
  tooltip,
  ariaLabel,
  children,
  className = ''
}) => {
  if (!requiresRestart) {
    return null;
  }

  return (
    <span className={`restart-required-indicator ${className}`} title={tooltip} aria-label={ariaLabel} role="img">
      {children ?? '⟳'}
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
  /** Reload classification for the setting. */
  classification: ConfigReloadClassification | undefined;
  /** Whether to show the warning. */
  show?: boolean;
  /** Message to display. */
  message: string;
};

/**
 * Inline warning displayed when user modifies a non-reloadable setting.
 *
 * @example
 * ```tsx
 * const { classification } = useConfigReloadability({ configKey: 'shell' });
 *
 * <InlineRestartWarning classification={classification} show={hasChanged} message="This change will take effect after restarting." />
 * ```
 */
export const InlineRestartWarning: React.FC<InlineRestartWarningProps> = ({classification, show = false, message}) => {
  if (!show || classification !== 'restart') {
    return null;
  }

  return (
    <div className="inline-restart-warning" role="alert">
      {message}
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

/** Common CSS styles for the config reload badge (used by both output and button variants). */
const commonBadgeStyles = `
  .config-reload-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background-color: #f59e0b; /* amber-500 */
    color: white;
    border-radius: 4px;
    font-size: 0.8125em;
    font-weight: 500;
  }

  .badge-icon {
    font-size: 1em;
  }

  .badge-text {
    white-space: nowrap;
  }
`;

/** Props for the ConfigReloadBadge component. */
export type ConfigReloadBadgeProps = {
  /** Whether to show the badge (when there are pending restart-required changes). */
  hasPendingChanges: boolean;
  /** The number of pending changes (optional). */
  pendingCount?: number;
  /** Label text for the badge (e.g., "Restart required"). */
  label: string;
  /** Accessible label for the badge. */
  ariaLabel: string;
  /** Title text for the interactive button variant. */
  title?: string;
  /** Callback when the badge is clicked (e.g., to show details). */
  onClick?: () => void;
};

/**
 * Badge component indicating pending configuration changes requiring restart.
 *
 * @example
 * ```tsx
 * <ConfigReloadBadge
 *   hasPendingChanges={true}
 *   pendingCount={2}
 *   label="Restart required"
 *   ariaLabel="Configuration changes require restart"
 *   title="Configuration changes require restart"
 *   onClick={showDetails}
 * />
 * ```
 */
export const ConfigReloadBadge: React.FC<ConfigReloadBadgeProps> = ({
  hasPendingChanges,
  pendingCount,
  label,
  ariaLabel,
  title,
  onClick
}) => {
  if (!hasPendingChanges) {
    return null;
  }

  const content = (
    <>
      <span className="badge-icon">⟳</span>
      <span className="badge-text">
        {label}
        {pendingCount !== undefined && pendingCount > 0 && ` (${pendingCount})`}
      </span>
    </>
  );

  // Render as non-interactive element when no onClick handler provided
  if (!onClick) {
    return (
      <output className="config-reload-badge" aria-label={ariaLabel}>
        {content}
        <style jsx={true}>{commonBadgeStyles}</style>
      </output>
    );
  }

  return (
    <button type="button" className="config-reload-badge" onClick={onClick} title={title ?? ariaLabel}>
      {content}
      <style jsx={true}>{`
        ${commonBadgeStyles}

        .config-reload-badge {
          border: none;
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
      `}</style>
    </button>
  );
};

/** Props for the LiveReloadIndicator component. */
export type LiveReloadIndicatorProps = {
  /** Reload classification for the setting. */
  classification: ConfigReloadClassification | undefined;
  /** Whether to show the indicator. */
  show?: boolean;
  /** Tooltip text for the indicator. */
  tooltip: string;
  /** Accessible label for the indicator. */
  ariaLabel: string;
  /** Override content for the indicator. */
  children?: React.ReactNode;
};

/**
 * Indicator component showing that a setting can be live-reloaded.
 *
 * This is optional UI sugar to indicate which settings apply immediately.
 *
 * Note: The `show` prop defaults to `true` (unlike `InlineRestartWarning` which
 * defaults to `false`) because live reload indicators are non-disruptive and
 * informational. They indicate a positive capability (changes apply immediately)
 * rather than a warning about required action. This follows the design principle
 * that purely informational indicators should be visible by default, while
 * disruptive warnings should require explicit opt-in via `show={true}`.
 *
 * @example
 * ```tsx
 * const { classification } = useConfigReloadability({ configKey: 'fontSize' });
 *
 * <label>
 *   Font Size
 *   <LiveReloadIndicator
 *     classification={classification}
 *     tooltip="This setting can be changed without restarting"
 *     ariaLabel="Live reloadable"
 *   />
 * </label>
 * ```
 */
export const LiveReloadIndicator: React.FC<LiveReloadIndicatorProps> = ({
  classification,
  show = true,
  tooltip,
  ariaLabel,
  children
}) => {
  if (!show || classification !== 'live') {
    return null;
  }

  return (
    <span className="live-reload-indicator" title={tooltip} aria-label={ariaLabel} role="img">
      {children ?? '⚡'}
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
