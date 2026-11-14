// The article's sections at one moment: its blocks grouped under the heading above them.
// This is what the contents list is built from, so the list changes as the article does.
// Pure functions.
import { churnLevel } from './time';
import type { FrameBlock, Wording } from './types';

export const TOP_TITLE = '(Top)';

export interface Section {
  /** The heading block, or null for the lead: the text above the first heading. */
  headingParaId: number | null;
  title: string;
  /** The paragraphs and list items under the heading, in reading order. */
  paraIds: number[];
}

type WordingOf = (hash: string) => Wording | undefined;

/** Groups blocks under their headings. A block whose text is not loaded yet counts as a paragraph. */
export function buildSections(blocks: readonly FrameBlock[], wordingOf: WordingOf): Section[] {
  const headingAt = blocks.flatMap((block, index) => (wordingOf(block.hash)?.kind === 'h' ? [index] : []));
  const lead = blocks.slice(0, headingAt[0] ?? blocks.length);
  const top: Section[] = lead.length === 0 ? []
    : [{ headingParaId: null, title: TOP_TITLE, paraIds: lead.map((block) => block.paraId) }];
  const under = headingAt.flatMap((start, n): Section[] => {
    const heading = blocks[start];
    if (heading === undefined) return [];
    const end = headingAt[n + 1] ?? blocks.length;
    return [{
      headingParaId: heading.paraId,
      title: wordingOf(heading.hash)?.text ?? '',
      paraIds: blocks.slice(start + 1, end).map((block) => block.paraId),
    }];
  });
  return [...top, ...under];
}

/** The section that holds a paragraph, or whose heading it is; -1 when there is none. */
export function sectionIndexOf(sections: readonly Section[], paraId: number | null): number {
  if (paraId === null) return -1;
  return sections.findIndex((section) => section.headingParaId === paraId || section.paraIds.includes(paraId));
}

/** How much a section has been reworded: the level of its most reworded paragraph, 0 when unknown. */
export function sectionHeat(section: Section, churn: Readonly<Record<string, number>> | null): number {
  if (churn === null) return 0;
  return section.paraIds.reduce((heat, paraId) => {
    const wordings = churn[String(paraId)];
    return wordings === undefined ? heat : Math.max(heat, churnLevel(wordings));
  }, 0);
}
