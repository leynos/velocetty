import type {ITermState} from '../../typings/hyper';

/** Finds the term group directly containing the given session, if any. */
export default function findBySession(termGroupState: ITermState, sessionUid: string) {
  const {termGroups} = termGroupState;
  return Object.keys(termGroups)
    .map((uid) => termGroups[uid])
    .find((group) => group.sessionUid === sessionUid);
}
