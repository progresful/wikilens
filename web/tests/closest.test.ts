import { describe, expect, it } from 'vitest';

import { closestIndex, quote, standing, thenAndNow, wordChange } from '../src/closest';
import type { Segment } from '../src/types';

const wording = (start: number, end: number, hash: string, text: string): Segment => ({
  kind: 'wording', start, end, hash, text, revId: 1, label: 'text changed', tone: 0, loose: false, reverted: false,
});
const gap = (start: number, end: number): Segment => ({
  kind: 'gap', start, end, hash: null, text: null, revId: null, label: 'removed', tone: -1, loose: false, reverted: false,
});

const OLD = 'Talvisota alkoi marraskuussa 1939, kun Neuvostoliitto hyökkäsi Suomeen.';
const NEW = 'Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen ilman sodanjulistusta.';
// old · new · old again · removed · new
const life = [wording(0, 10, 'old', OLD), wording(10, 20, 'new', NEW), wording(20, 30, 'old', OLD), gap(30, 40), wording(40, 50, 'new', NEW)];

describe('closestIndex', () => {
  it('finds the first time the paragraph had the closest wording', () => {
    expect(closestIndex(life, 'old')).toBe(0);
    expect(closestIndex(life, 'new')).toBe(1);
  });

  it('finds nothing when no wording was singled out, or it is not in this life', () => {
    expect(closestIndex(life, null)).toBe(-1);
    expect(closestIndex(life, 'other')).toBe(-1);
    expect(closestIndex([], 'old')).toBe(-1);
  });
});

describe('wordChange', () => {
  it('counts the words that left and the words that came, not the punctuation', () => {
    expect(wordChange(OLD, NEW)).toEqual({ gone: 1, added: 4 });       // marraskuussa · 30, marraskuuta, ilman, sodanjulistusta
    expect(wordChange(NEW, OLD)).toEqual({ gone: 4, added: 1 });
    expect(wordChange(OLD, OLD)).toEqual({ gone: 0, added: 0 });
  });
});

describe('thenAndNow', () => {
  it('says which wording was closest and how the one shown differs from it', () => {
    expect(thenAndNow(life, 4, 'old')).toEqual({ closest: life[0], until: 30, stretches: 2, change: { gone: 1, added: 4 } });
  });

  it('gives the whole span of a wording that came back: from its first start to its last end', () => {
    const found = thenAndNow(life, 0, 'new');
    expect(found?.closest).toBe(life[1]);
    expect(found?.until).toBe(50);
    expect(found?.stretches).toBe(2);
    const once = thenAndNow([wording(0, 10, 'old', OLD), wording(10, 20, 'new', NEW)], 1, 'old');
    expect([once?.until, once?.stretches]).toEqual([10, 1]);
  });

  it('has nothing to say while the closest wording is the one shown', () => {
    expect(thenAndNow(life, 0, 'old')).toBeNull();
    expect(thenAndNow(life, 2, 'old')).toBeNull();          // the same wording, in force again
  });

  it('reports no word change where the paragraph is out of the article', () => {
    expect(thenAndNow(life, 3, 'old')).toEqual({ closest: life[0], until: 30, stretches: 2, change: null });
  });

  it('has nothing to say before the paragraph exists, or when no wording was singled out', () => {
    expect(thenAndNow(life, -1, 'old')).toBeNull();
    expect(thenAndNow(life, 4, null)).toBeNull();
    expect(thenAndNow(life, 4, 'other')).toBeNull();
  });
});

describe('standing', () => {
  it('counts the stretches a wording stood for and when the last one ended', () => {
    expect(standing(life, 'old')).toEqual({ stretches: 2, until: 30 });
    expect(standing(life, 'new')).toEqual({ stretches: 2, until: 50 });
  });

  it('counts nothing for a wording the paragraph never had', () => {
    expect(standing(life, 'other')).toEqual({ stretches: 0, until: 0 });
    expect(standing(life, null)).toEqual({ stretches: 0, until: 0 });
  });
});

describe('quote', () => {
  it('gives a short wording whole and cuts a long one at the limit', () => {
    expect(quote('lyhyt', 10)).toBe('lyhyt');
    expect(quote('yksi kaksi kolme neljä', 10)).toBe('yksi kaksi…');
  });

  it('never cuts a character in half', () => {
    expect(quote('ab😀cd', 3)).toBe('ab😀…');
  });
});
