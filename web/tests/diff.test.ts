import { describe, expect, it } from 'vitest';

import { diffWords, needsSpaceBefore, tokenize } from '../src/diff';

describe('tokenize', () => {
  it('splits words from punctuation', () => {
    expect(tokenize('Sota alkoi 30. marraskuuta 1939, kun')).toEqual(
      ['Sota', 'alkoi', '30', '.', 'marraskuuta', '1939', ',', 'kun'],
    );
  });

  it('keeps Finnish letters and hyphenated or dashed compounds whole', () => {
    expect(tokenize('Jääkäriliike sai Ryti–Ribbentrop-sopimuksen')).toEqual(
      ['Jääkäriliike', 'sai', 'Ryti–Ribbentrop-sopimuksen'],
    );
  });

  it('returns nothing for empty or blank text', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('  \n ')).toEqual([]);
  });
});

describe('diffWords', () => {
  it('reports a replaced word as a removal followed by an insertion', () => {
    expect(diffWords(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { type: 'eq', token: 'a' },
      { type: 'del', token: 'b' },
      { type: 'ins', token: 'x' },
      { type: 'eq', token: 'c' },
    ]);
  });

  it('handles empty sides', () => {
    expect(diffWords([], ['a'])).toEqual([{ type: 'ins', token: 'a' }]);
    expect(diffWords(['a'], [])).toEqual([{ type: 'del', token: 'a' }]);
    expect(diffWords([], [])).toEqual([]);
  });

  it('keeps identical text as all equal', () => {
    expect(diffWords(['a', 'b'], ['a', 'b']).every((op) => op.type === 'eq')).toBe(true);
  });

  it('marks an added sentence as insertions and nothing else', () => {
    const before = tokenize('Sota alkoi.');
    const after = tokenize('Sota alkoi. Se päättyi 1940.');
    const ops = diffWords(before, after);
    expect(ops.filter((op) => op.type === 'del')).toEqual([]);
    expect(ops.filter((op) => op.type === 'ins').map((op) => op.token)).toEqual(['Se', 'päättyi', '1940', '.']);
  });
});

describe('needsSpaceBefore', () => {
  it('puts no space before closing punctuation or at the start', () => {
    expect(needsSpaceBefore(',', false)).toBe(false);
    expect(needsSpaceBefore('.', false)).toBe(false);
    expect(needsSpaceBefore(')', false)).toBe(false);
    expect(needsSpaceBefore('kun', true)).toBe(false);
  });

  it('puts a space before a word', () => {
    expect(needsSpaceBefore('kun', false)).toBe(true);
    expect(needsSpaceBefore('1939', false)).toBe(true);
  });
});
