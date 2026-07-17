import type {HyperState, HyperDispatch} from '../../typings/hyper';
import {dismissNotification} from '../actions/notifications';
import {installUpdate} from '../actions/updater';
import Notifications from '../components/notifications';
import {connect} from '../utils/plugins';

const mapStateToProps = (state: HyperState) => {
  const {ui} = state;
  const {notifications} = ui;
  let state_: Partial<{
    /** Shows the transient font-size notification while a font-size change is pending. */
    fontShowing: boolean;
    /** Font size in points, used to compute `fontText`. */
    fontSize: number;
    /** Formatted font-size label (e.g. `14px`) shown in the notification. */
    fontText: string;
    /** Shows the transient resize notification while a terminal resize is pending. */
    resizeShowing: boolean;
    /** Terminal column count shown in the resize notification. */
    cols: number | null;
    /** Terminal row count shown in the resize notification. */
    rows: number | null;
    /** Shows the update-available notification. */
    updateShowing: boolean;
    /** Version string of the available update, shown in the notification. */
    updateVersion: string | null;
    /** First line of the update's release notes, shown in the notification. */
    updateNote: string | null;
    /** Release page URL linked from the update notification. */
    updateReleaseUrl: string | null;
    /** Whether the available update can be installed from within the app. */
    updateCanInstall: boolean | null;
    /** Shows the generic message notification. */
    messageShowing: boolean;
    /** Body text of the generic message notification. */
    messageText: string | null;
    /** Optional link URL associated with the generic message notification. */
    messageURL: string | null;
    /** Whether the user can dismiss the generic message notification. */
    messageDismissable: boolean | null;
  }> = {};

  if (notifications.font) {
    const fontSize = ui.fontSizeOverride || ui.fontSize;

    state_ = {
      ...state_,
      fontShowing: true,
      fontSize,
      fontText: `${fontSize}px`
    };
  }

  if (notifications.resize) {
    const cols = ui.cols;
    const rows = ui.rows;

    state_ = {
      ...state_,
      resizeShowing: true,
      cols,
      rows
    };
  }

  if (notifications.updates) {
    state_ = {
      ...state_,
      updateShowing: true,
      updateVersion: ui.updateVersion,
      updateNote: ui.updateNotes?.split('\n')[0],
      updateReleaseUrl: ui.updateReleaseUrl,
      updateCanInstall: ui.updateCanInstall
    };
  } else if (notifications.message) {
    state_ = {
      ...state_,
      messageShowing: true,
      messageText: ui.messageText,
      messageURL: ui.messageURL,
      messageDismissable: ui.messageDismissable
    };
  }

  return state_;
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    /** Dismisses the font-size notification. */
    onDismissFont: () => {
      dispatch(dismissNotification('font'));
    },
    /** Dismisses the resize notification. */
    onDismissResize: () => {
      dispatch(dismissNotification('resize'));
    },
    /** Dismisses the update-available notification. */
    onDismissUpdate: () => {
      dispatch(dismissNotification('updates'));
    },
    /** Dismisses the generic message notification. */
    onDismissMessage: () => {
      dispatch(dismissNotification('message'));
    },
    /** Installs the pending application update. */
    onUpdateInstall: () => {
      dispatch(installUpdate());
    }
  };
};

/** Transient notification banners (font size, resize, update, message), connected to renderer state. */
const NotificationsContainer = connect(mapStateToProps, mapDispatchToProps, null)(Notifications, 'Notifications');

export default NotificationsContainer;

/** Props supplied to the notifications banner by `connect`, combining state selections and dispatch bindings. */
export type NotificationsConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
