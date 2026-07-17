import type Term from './components/term';

// react Term components add themselves
// to this object upon mounting / unmounting
// this is to allow imperative access to the
// term API, which is a performance
// optimization for the most common action
// within the system

/** Registry of mounted terminal instances, keyed by session uid. */
const terms: Record<string, Term | null> = {};
/** Registry of mounted `Term` instances by session uid, for imperative access outside React. */
/** Registry of mounted terminal instances, keyed by session uid. */
export default terms;
