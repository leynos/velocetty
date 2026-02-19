/** @file Public `when` parser and evaluator exports. */
export {
  compileWhenExpression,
  parseWhenExpression,
  WhenExpressionSyntaxError
} from './context-key-parser';

export {
  evaluateWhenExpression,
  evaluateWhenExpressionAst
} from './context-key-evaluator';
