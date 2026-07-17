import {createSelector} from 'reselect';

import type {HyperState} from '../typings/hyper';

const getTermGroups = ({termGroups}: Pick<HyperState, 'termGroups'>) => termGroups.termGroups;
/** Selects the root term groups (tabs), i.e. those without a parent. */
export const getRootGroups = createSelector(getTermGroups, (termGroups) =>
  Object.keys(termGroups)
    .map((uid) => termGroups[uid])
    .filter(({parentUid}) => !parentUid)
);
