import {createSelector} from 'reselect';

import type {HyperState} from '../typings/hyper';
import {getTermGroup} from './utils/term-groups';

const getTermGroups = ({termGroups}: Pick<HyperState, 'termGroups'>) => termGroups.termGroups;
export const getRootGroups = createSelector(getTermGroups, (termGroups) =>
  Object.keys(termGroups)
    .map((uid) => getTermGroup(termGroups, uid))
    .filter(({parentUid}) => !parentUid)
);
