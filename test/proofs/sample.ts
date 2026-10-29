/** @file Smoke-test LemmaScript contract for `make prove`. */

/**
 * Returns zero.
 *
 * The contract exists only to prove that the verification toolchain is wired
 * up: if the generated Dafny is verified, the postcondition is discharged.
 *
 * @returns Zero.
 *
 * @example
 * ```ts
 * zero(); // 0
 * ```
 */
//@ ensures \result === 0
export function zero(): number {
  return 0;
}
