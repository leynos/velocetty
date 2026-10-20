/** @file Connects the tabs strip to renderer plug-in services. */
import {decorate, getTabProps, subscribeTabDecorationUpdates} from '../utils/plugins';
import DropdownButton from './new-tab';
import {createTabsComponent} from './tabs-component';

const Tabs = createTabsComponent({
  decorate,
  getTabProps,
  subscribeTabDecorationUpdates,
  DropdownButton
});

Tabs.displayName = 'Tabs';

export default Tabs;
