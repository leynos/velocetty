/**
 * @file Direct tests for the JSON5 scanner primitives and key parsing.
 *
 * The edit operations are covered through whole documents elsewhere; these
 * cases pin the primitives those operations rely on, where a plausible wrong
 * implementation (an off-by-one end index, an accepted bad escape, a digit
 * allowed as an identifier start) would otherwise only show up as a strange
 * edit elsewhere.
 */
import {describe, expect, test} from 'bun:test';

import {parserFailureSentinel} from '../../app/config/json5/characters';
import {parseObjectKey} from '../../app/config/json5/keys';
import {
  getLineIndent,
  getLineStartIndex,
  parseIdentifierCharacter,
  parseQuotedStringEnd,
  parseUnicodeEscapeCharacter,
  readCodePoint,
  skipBlockComment,
  skipLineComment,
  skipWhitespaceAndComments
} from '../../app/config/json5/lexer';
import {sourceText} from '../../app/config/json5/source-text';

const at = (index: number) => ({index});

/** The two Unicode line separators JSON5 treats as terminators. */
const LINE_SEPARATOR = String.fromCodePoint(0x20_28);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x20_29);

describe('comment and whitespace skipping', () => {
  test('a line comment ends at every line terminator', () => {
    for (const terminator of ['\n', '\r', LINE_SEPARATOR, PARAGRAPH_SEPARATOR]) {
      const source = `// note${terminator}next`;
      expect(skipLineComment(sourceText(source), {startIndex: 0, limitIndex: source.length})).toBe(7);
    }
  });

  test('an unterminated line comment ends at the limit', () => {
    const source = '// note';
    expect(skipLineComment(sourceText(source), {startIndex: 0, limitIndex: source.length})).toBe(source.length);
  });

  test('a block comment ends after its closing marker', () => {
    const source = '/* a\nb */rest';
    expect(skipBlockComment(sourceText(source), {startIndex: 0, limitIndex: source.length})).toBe(9);
  });

  test('an unterminated block comment reports the failure sentinel', () => {
    const source = '/* never closed';
    expect(skipBlockComment(sourceText(source), {startIndex: 0, limitIndex: source.length})).toBe(
      parserFailureSentinel
    );
  });

  test('whitespace and both comment styles are skipped in one pass', () => {
    const source = ' \t/* a */ // b\n next';
    // Indices 0-15 are whitespace and both comment forms; 'next' starts at 16.
    expect(skipWhitespaceAndComments(source, {startIndex: 0, limitIndex: source.length})).toBe(16);
  });

  test('an unterminated block comment stops the scan with the sentinel', () => {
    const source = '  /* never closed';
    expect(skipWhitespaceAndComments(source, {startIndex: 0, limitIndex: source.length})).toBe(parserFailureSentinel);
  });
});

describe('quoted strings', () => {
  test('a quoted string ends after its closing quote', () => {
    expect(parseQuotedStringEnd('"ab" rest', {startIndex: 0, limitIndex: 10})).toBe(4);
    expect(parseQuotedStringEnd("'ab' rest", {startIndex: 0, limitIndex: 10})).toBe(4);
  });

  test('an escaped quote does not close the string', () => {
    expect(parseQuotedStringEnd(String.raw`"a\"b"`, {startIndex: 0, limitIndex: 6})).toBe(6);
  });

  test('an unterminated or dangling-escape string reports -1', () => {
    expect(parseQuotedStringEnd('"abc', {startIndex: 0, limitIndex: 4})).toBe(-1);
    expect(parseQuotedStringEnd('"abc\\', {startIndex: 0, limitIndex: 5})).toBe(-1);
  });
});

describe('Unicode escapes and code points', () => {
  test('a four-hex-digit escape yields its character and length', () => {
    expect(parseUnicodeEscapeCharacter(sourceText(String.raw`\u0061x`), at(0))).toEqual({
      character: 'a',
      nextIndex: 6
    });
  });

  test('a braced escape yields its code point and length', () => {
    expect(parseUnicodeEscapeCharacter(sourceText(String.raw`\u{1F600}!`), at(0))).toEqual({
      character: '\u{1F600}',
      nextIndex: 9
    });
  });

  test('a malformed or incomplete escape is refused', () => {
    for (const source of [String.raw`\u00zz`, String.raw`\u{61`, String.raw`\u{}`, String.raw`\u{110000}`, 'a']) {
      expect(parseUnicodeEscapeCharacter(sourceText(source), at(0))).toBeNull();
    }
  });

  test('reading a surrogate pair advances by both code units', () => {
    expect(readCodePoint(sourceText('\u{1F600}!'), at(0))).toEqual({character: '\u{1F600}', nextIndex: 2});
    expect(readCodePoint(sourceText(''), at(0))).toBeNull();
  });

  test('an identifier start rejects a digit but its continuation accepts one', () => {
    expect(parseIdentifierCharacter('1a', at(0), true)).toBeNull();
    expect(parseIdentifierCharacter('1a', at(0), false)).toEqual({character: '1', nextIndex: 1});
    expect(parseIdentifierCharacter('$a', at(0), true)).toEqual({character: '$', nextIndex: 1});
    expect(parseIdentifierCharacter(String.raw`\u0061b`, at(0), true)).toEqual({character: 'a', nextIndex: 6});
  });
});

describe('line positions', () => {
  test('the line start follows every terminator', () => {
    expect(getLineStartIndex('one\ntwo', at(5))).toBe(4);
    expect(getLineStartIndex('one\r\ntwo', at(6))).toBe(5);
    expect(getLineStartIndex(`one${LINE_SEPARATOR}two`, at(5))).toBe(4);
    expect(getLineStartIndex(`one${PARAGRAPH_SEPARATOR}two`, at(5))).toBe(4);
    expect(getLineStartIndex('one', at(2))).toBe(0);
  });

  test('the indent is the leading whitespace of the line only', () => {
    expect(getLineIndent('  key: 1', at(4))).toBe('  ');
    expect(getLineIndent('\t\tkey: 1', at(5))).toBe('\t\t');
    expect(getLineIndent('key: 1', at(2))).toBe('');
  });
});

describe('object keys', () => {
  test('an unquoted key ends at its first non-identifier character', () => {
    expect(parseObjectKey('{a1: 2}', {startIndex: 1, limitIndex: 6})).toEqual({
      key: 'a1',
      startIndex: 1,
      endIndex: 3
    });
  });

  test('a quoted key keeps its spaces and escapes', () => {
    expect(parseObjectKey('{"a b": 1}', {startIndex: 1, limitIndex: 9})).toEqual({
      key: 'a b',
      startIndex: 1,
      endIndex: 6
    });
    expect(parseObjectKey(String.raw`'a\'b': 1`, {startIndex: 0, limitIndex: 10})).toEqual({
      key: "a'b",
      startIndex: 0,
      endIndex: 6
    });
  });

  test('an escaped identifier key is decoded', () => {
    expect(parseObjectKey(String.raw`\u0061: 1`, {startIndex: 0, limitIndex: 8})).toEqual({
      key: 'a',
      startIndex: 0,
      endIndex: 6
    });
  });

  test('a digit start or an unterminated quote is refused', () => {
    expect(parseObjectKey('{1: 2}', {startIndex: 1, limitIndex: 5})).toBeNull();
    expect(parseObjectKey('"abc', {startIndex: 0, limitIndex: 4})).toBeNull();
  });
});
