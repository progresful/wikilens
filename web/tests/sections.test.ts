import { describe, expect, it } from 'vitest';

import { buildSections, sectionHeat, sectionIndexOf } from '../src/sections';
import type { FrameBlock, Wording } from '../src/types';

const wordings: Record<string, Wording> = {
  lead1: { kind: 'p', text: 'Johdanto.' },
  lead2: { kind: 'p', text: 'Toinen johdantokappale.' },
  h1: { kind: 'h', text: 'Tausta' },
  p1: { kind: 'p', text: 'Taustaa.' },
  li1: { kind: 'li', text: 'kohta' },
  h2: { kind: 'h', text: 'Sota' },
  p2: { kind: 'p', text: 'Sodasta.' },
};
const of = (hash: string): Wording | undefined => wordings[hash];
const block = (paraId: number, hash: string): FrameBlock => ({ paraId, hash, revId: 1 });

describe('buildSections', () => {
  it('groups blocks under the heading above them, with the lead as (Top)', () => {
    const sections = buildSections(
      [block(1, 'lead1'), block(2, 'lead2'), block(3, 'h1'), block(4, 'p1'), block(5, 'li1'), block(6, 'h2'), block(7, 'p2')], of);
    expect(sections).toEqual([
      { headingParaId: null, title: '(Top)', paraIds: [1, 2] },
      { headingParaId: 3, title: 'Tausta', paraIds: [4, 5] },
      { headingParaId: 6, title: 'Sota', paraIds: [7] },
    ]);
  });

  it('has no (Top) entry when the article starts with a heading', () => {
    expect(buildSections([block(3, 'h1'), block(4, 'p1')], of).map((s) => s.title)).toEqual(['Tausta']);
  });

  it('keeps a heading with nothing under it, and treats text not loaded yet as a paragraph', () => {
    const sections = buildSections([block(1, 'unknown'), block(3, 'h1'), block(6, 'h2'), block(7, 'p2')], of);
    expect(sections).toEqual([
      { headingParaId: null, title: '(Top)', paraIds: [1] },
      { headingParaId: 3, title: 'Tausta', paraIds: [] },
      { headingParaId: 6, title: 'Sota', paraIds: [7] },
    ]);
  });

  it('gives nothing for an empty article', () => {
    expect(buildSections([], of)).toEqual([]);
  });
});

describe('sections and the answer', () => {
  const sections = buildSections([block(1, 'lead1'), block(3, 'h1'), block(4, 'p1'), block(6, 'h2'), block(7, 'p2')], of);

  it('finds the section holding a paragraph, or the heading itself', () => {
    expect(sectionIndexOf(sections, 1)).toBe(0);
    expect(sectionIndexOf(sections, 4)).toBe(1);
    expect(sectionIndexOf(sections, 6)).toBe(2);
    expect(sectionIndexOf(sections, 99)).toBe(-1);
    expect(sectionIndexOf(sections, null)).toBe(-1);
  });

  it('rates a section by its most reworded paragraph', () => {
    const churn = { '1': 1, '4': 9, '7': 2 };
    expect(sections.map((section) => sectionHeat(section, churn))).toEqual([1, 4, 2]);
    expect(sectionHeat(sections[1]!, null)).toBe(0);
    expect(sectionHeat({ headingParaId: 3, title: 'x', paraIds: [] }, churn)).toBe(0);
  });
});
