/** @file Structured parse error payload for `when` expressions. */
import type {WhenExpressionParseError} from '@shared/types/context-keys';

/** Structured parse error with stable source/index metadata. */
export class WhenExpressionSyntaxError extends SyntaxError implements WhenExpressionParseError {
  /** The `when` expression source that failed to parse. */
  readonly source: string;
  /** Character offset in `source` at which parsing failed. */
  readonly index: number;

  constructor(message: string, source: string, index: number) {
    super(message);
    this.name = 'WhenExpressionSyntaxError';
    this.source = source;
    this.index = index;
  }
}
