/** Returns the enumerable own keys of an object. */
export const ObjectTypedKeys = <T extends object>(obj: T) => {
  // SAFETY: Object.keys returns own string keys, each of which is a key of T.
  return Object.keys(obj) as (keyof T)[];
};
