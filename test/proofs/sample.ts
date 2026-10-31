/**
 * @file Registered LemmaScript smoke-test source for `make prove`.
 *
 * This module provides the `zero` contract used to verify LemmaScript-to-Dafny
 * generation and proof execution. The proof workflow regenerates and verifies
 * `test/proofs/sample.dfy.gen` from this source.
 */

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
