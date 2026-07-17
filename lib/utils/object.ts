// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unsafe-return */
const valsCache = new WeakMap();

/** Returns (and caches by identity) the values of an object, for cheap repeated lookups on immutables. */
export function values(imm: Record<string, any>) {
  if (!valsCache.has(imm)) {
    valsCache.set(imm, Object.values(imm));
  }
  return valsCache.get(imm);
}

const keysCache = new WeakMap();
/** Returns (and caches by identity) the keys of an object, for cheap repeated lookups on immutables. */
export function keys(imm: Record<string, any>) {
  if (!keysCache.has(imm)) {
    keysCache.set(imm, Object.keys(imm));
  }
  return keysCache.get(imm);
}

/** `Object.keys` typed to return `(keyof T)[]` instead of `string[]`. */
export const ObjectTypedKeys = <T extends object>(obj: T) => {
  return Object.keys(obj) as (keyof T)[];
};
