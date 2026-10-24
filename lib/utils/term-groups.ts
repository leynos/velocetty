/** @file Lookups over the terminal-group tree held in renderer state. */
import type {ITermGroup, ITermGroups, ITermState} from '../../typings/hyper';

/**
 * Returns the group registered under `uid`.
 *
 * Callers resolve these uids from the tree itself — a parent link or a child
 * list — so a missing entry means the tree is corrupt. Throwing names the
 * offending uid instead of letting `undefined` travel on into a reducer.
 */
export const getTermGroup = (termGroups: ITermGroups, uid: string): ITermGroup => {
  const group = termGroups[uid];
  if (!group) {
    throw new Error(`Unknown terminal group: ${uid}`);
  }
  return group;
};

export default function findBySession(termGroupState: ITermState, sessionUid: string): ITermGroup | undefined {
  const {termGroups} = termGroupState;
  return Object.keys(termGroups)
    .map((uid) => getTermGroup(termGroups, uid))
    .find((group) => group.sessionUid === sessionUid);
}
