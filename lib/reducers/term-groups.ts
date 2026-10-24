import Immutable from 'seamless-immutable';
import type {Immutable as ImmutableType} from 'seamless-immutable';
import {v4 as uuidv4} from 'uuid';

import {SESSION_ADD, SESSION_SET_ACTIVE} from '@shared/constants/sessions';
import type {SessionAddAction} from '@shared/constants/sessions';
import {TERM_GROUP_EXIT, TERM_GROUP_RESIZE} from '@shared/constants/term-groups';
import type {ITermGroup, ITermState, ITermGroups, ITermGroupReducer, Mutable} from '../../typings/hyper';
import {decorateTermGroupsReducer} from '../utils/plugins';
import findBySession, {getTermGroup} from '../utils/term-groups';

const MIN_SIZE = 0.05;
const initialState: ITermState = Immutable<Mutable<ITermState>>({
  termGroups: {},
  activeSessions: {},
  activeRootGroup: null
});

function TermGroup(obj: Immutable.DeepPartial<Mutable<ITermGroup>>) {
  const x: Mutable<ITermGroup> = {
    uid: '',
    sessionUid: null,
    parentUid: null,
    direction: null,
    sizes: null,
    children: []
  };
  return Immutable(x).merge(obj);
}

// Recurse upwards until we find a root term group (no parent).
const findRootGroup = (termGroups: ITermGroups, uid: string): ITermGroup => {
  const current = getTermGroup(termGroups, uid);
  if (!current.parentUid) {
    return current;
  }

  return findRootGroup(termGroups, current.parentUid);
};

const setActiveGroup = (state: ITermState, action: {uid: string}) => {
  if (!action.uid) {
    return state.set('activeRootGroup', null);
  }

  const childGroup = findBySession(state, action.uid)!;
  const rootGroup = findRootGroup(state.termGroups, childGroup.uid);
  return state.set('activeRootGroup', rootGroup.uid).setIn(['activeSessions', rootGroup.uid], action.uid);
};

// Reduce existing sizes to fit a new split:
const insertRebalance = (oldSizes: ImmutableType<number[]>, index: number) => {
  const newSize = 1 / (oldSizes.length + 1);
  // We spread out how much each pane should be reduced
  // with based on their existing size:
  const balanced = oldSizes.map((size) => size - newSize * size);
  return [...balanced.slice(0, index).asMutable(), newSize, ...balanced.slice(index).asMutable()];
};

// Spread out the removed size to all the existing sizes:
const removalRebalance = (oldSizes: ImmutableType<number[]>, index: number) => {
  const removedSize = oldSizes[index];
  const increase = removedSize / (oldSizes.length - 1);
  return Immutable(
    oldSizes
      .asMutable()
      .filter((_size: number, i: number) => i !== index)
      .map((size: number) => size + increase)
  );
};

/**
 * Resolves the group a split should attach to.
 *
 * The action names the session being split; fall back to the session active in
 * the current root group when it does not, so a split with no explicit target
 * still lands on the pane the user is looking at.
 */
const resolveSplitTarget = (state: ITermState, action: SessionAddAction): ITermGroup => {
  const activeRootGroup = state.activeRootGroup;
  const splitTargetUid =
    action.activeUid ?? (activeRootGroup === null ? null : (state.activeSessions[activeRootGroup] ?? null));
  const activeGroup = splitTargetUid === null ? undefined : findBySession(state, splitTargetUid);
  if (!activeGroup) {
    throw new Error(`Cannot split: no terminal group for session ${String(splitTargetUid)}`);
  }
  return activeGroup;
};

/**
 * Picks the group that will become the split's parent.
 *
 * Splitting in the same direction as the current parent — or the first split
 * for that group — gives the parent another child. Splitting in a different
 * direction makes the active group a new parent instead, so panes stay
 * grouped by orientation.
 */
const resolveParentGroup = (
  state: ITermState,
  activeGroup: ITermGroup,
  splitDirection: SessionAddAction['splitDirection']
) => {
  const parentGroup = activeGroup.parentUid ? getTermGroup(state.termGroups, activeGroup.parentUid) : activeGroup;
  const isSameDirection = !parentGroup.direction || parentGroup.direction === splitDirection;
  return isSameDirection ? parentGroup : activeGroup;
};

/**
 * Turns an existing session into a new parent of two leaf groups.
 *
 * The layout goes from `P` to `P` with children `G G`: the original session
 * keeps its place as the first child and the new session takes the second.
 */
const splitExistingSession = (
  state: ITermState,
  parentGroup: ITermGroup,
  newSession: ITermGroup,
  splitDirection: SessionAddAction['splitDirection']
) => {
  const existingSession = TermGroup({
    uid: uuidv4(),
    sessionUid: parentGroup.sessionUid,
    parentUid: parentGroup.uid
  });

  return state.setIn(['termGroups', existingSession.uid], existingSession).setIn(
    ['termGroups', parentGroup.uid],
    parentGroup.merge({
      sessionUid: '',
      direction: splitDirection,
      children: [existingSession.uid, newSession.uid]
    })
  );
};

const splitGroup = (state: ITermState, action: SessionAddAction) => {
  const {splitDirection, uid} = action;
  const activeGroup = resolveSplitTarget(state, action);
  const parentGroup = resolveParentGroup(state, activeGroup, splitDirection);
  const newSession = TermGroup({
    uid: uuidv4(),
    sessionUid: uid,
    parentUid: parentGroup.uid
  });

  state = state.setIn(['termGroups', newSession.uid], newSession);
  if (parentGroup.sessionUid) {
    return splitExistingSession(state, parentGroup, newSession, splitDirection);
  }

  const {children} = parentGroup;
  // Insert the new child pane right after the active one:
  const index = children.indexOf(activeGroup.uid) + 1;
  const newChildren = [...children.slice(0, index).asMutable(), newSession.uid, ...children.slice(index).asMutable()];
  state = state.setIn(
    ['termGroups', parentGroup.uid],
    parentGroup.merge({
      direction: splitDirection,
      children: newChildren
    })
  );

  if (parentGroup.sizes) {
    const newSizes = insertRebalance(parentGroup.sizes, index);
    state = state.setIn(['termGroups', parentGroup.uid, 'sizes'], newSizes);
  }

  return state;
};

// Replace the parent by the given child in the tree,
// used when we remove another child and we're left
// with a one-to-one mapping between parent and child.
const replaceParent = (state: ITermState, parent: ITermGroup, child: ITermGroup) => {
  if (parent.parentUid) {
    const parentParent = getTermGroup(state.termGroups, parent.parentUid);
    // If the parent we're replacing has a parent,
    // we need to change the uid in its children array
    // with `child`:
    const newChildren = parentParent.children.map((uid: string) => (uid === parent.uid ? child.uid : uid));

    state = state.setIn(['termGroups', parentParent.uid, 'children'], newChildren);
  } else {
    // This means the given child will be
    // a root group, so we need to set it up as such:
    const newSessions = state.activeSessions.without(parent.uid).set(child.uid, state.activeSessions[parent.uid]);

    state = state
      .set('activeTermGroup', child.uid)
      .set('activeRootGroup', child.uid)
      .set('activeSessions', newSessions);
  }

  return state
    .set('termGroups', state.termGroups.without(parent.uid))
    .setIn(['termGroups', child.uid, 'parentUid'], parent.parentUid);
};

/** A group's parent, looked up only when both the group and its link exist. */
const findLinkedParent = (state: ITermState, group: ITermGroup | undefined) => {
  const parentUid = group?.parentUid;
  const parent = parentUid ? state.termGroups[parentUid] : undefined;
  return parent && parentUid ? {parent, parentUid} : null;
};

/** Removes a child from its parent, collapsing the parent when one child is left. */
const detachFromParent = (state: ITermState, parent: ITermGroup, parentUid: string, uid: string): ITermState => {
  const newChildren = parent.children.filter((childUid) => childUid !== uid);
  if (newChildren.length === 1) {
    // Since we only have one child left,
    // we can merge the parent and child into one group:
    const child = getTermGroup(state.termGroups, newChildren[0]);
    return replaceParent(state, parent, child);
  }

  state = state.setIn(['termGroups', parentUid, 'children'], newChildren);
  if (parent.sizes) {
    const childIndex = parent.children.indexOf(uid);
    const newSizes = removalRebalance(parent.sizes, childIndex);
    state = state.setIn(['termGroups', parentUid, 'sizes'], newSizes);
  }
  return state;
};

const removeGroup = (state: ITermState, uid: string) => {
  const group = state.termGroups[uid];
  // Closing a tab with several panes removes groups parent-first, so a child
  // can be visited after its parent has already gone. That is safe: the
  // detach below is skipped, and the trailing `without` prunes what is left.
  const link = findLinkedParent(state, group);
  if (link) {
    state = detachFromParent(state, link.parent, link.parentUid, uid);
  }

  return state
    .set('termGroups', state.termGroups.without(uid))
    .set('activeSessions', state.activeSessions.without(uid));
};

const resizeGroup = (state: ITermState, uid: string, sizes: number[]) => {
  // Make sure none of the sizes fall below MIN_SIZE:
  if (sizes.some((size) => size < MIN_SIZE)) {
    return state;
  }

  return state.setIn(['termGroups', uid, 'sizes'], sizes);
};

const reducer: ITermGroupReducer = (state = initialState, action) => {
  switch (action.type) {
    case SESSION_ADD: {
      if (action.splitDirection) {
        state = splitGroup(state, action);
        return setActiveGroup(state, action);
      }

      const uid = uuidv4();
      const termGroup = TermGroup({
        uid,
        sessionUid: action.uid
      });

      return state
        .setIn(['termGroups', uid], termGroup)
        .setIn(['activeSessions', uid], action.uid)
        .set('activeRootGroup', uid);
    }
    case SESSION_SET_ACTIVE: {
      return setActiveGroup(state, action);
    }
    case TERM_GROUP_RESIZE: {
      return resizeGroup(state, action.uid, action.sizes);
    }
    case TERM_GROUP_EXIT: {
      return removeGroup(state, action.uid);
    }
    default: {
      return state;
    }
  }
};

export default decorateTermGroupsReducer(reducer);
