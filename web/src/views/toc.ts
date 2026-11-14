// The contents list: the article's own headings at the playhead, so it grows and shrinks as
// the article does. Each entry shows how much its section has been reworded, and the section
// holding the answer is marked. Heading text is written with textContent only.
import { buildSections, sectionHeat, sectionIndexOf } from '../sections';
import type { Frame } from '../types';
import type { WordingCache } from '../wordingCache';

export interface TocModel {
  frame: Frame | null;
  cache: WordingCache;
  wordingsVersion: number;
  /** Distinct wordings per paragraph, or null while a question is active. */
  churn: Readonly<Record<string, number>> | null;
  answerParaId: number | null;
}

export interface TocHandlers {
  /** A section was chosen: its heading's paragraph, or null for the top of the article. */
  onSection: (headingParaId: number | null) => void;
}

export interface TocView {
  update(model: TocModel): void;
}

interface Row {
  headingParaId: number | null;
  title: string;
  heat: number;
  hasAnswer: boolean;
}

const TITLE = 'Contents';
const HEAT_LEVELS = 5;

function rowsOf(model: TocModel, frame: Frame): Row[] {
  const sections = buildSections(frame.blocks, (hash) => model.cache.get(hash));
  const answerAt = sectionIndexOf(sections, model.answerParaId);
  return sections.map((section, index) => ({
    headingParaId: section.headingParaId,
    title: section.title,
    heat: sectionHeat(section, model.churn),
    hasAnswer: index === answerAt,
  }));
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function item(row: Row, handlers: TocHandlers): HTMLLIElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = row.hasAnswer ? 'toc-item has-answer' : 'toc-item';
  const heat = document.createElement('i');
  heat.className = row.heat > 0 ? `toc-heat heat-${row.heat}` : 'toc-heat';
  if (row.heat > 0) heat.title = `how much this section has been reworded: ${row.heat} of ${HEAT_LEVELS}`;
  button.append(heat, span('toc-text', row.title));
  if (row.hasAnswer) button.append(span('toc-answer', 'answer'));
  button.addEventListener('click', () => handlers.onSection(row.headingParaId));
  const entry = document.createElement('li');
  entry.append(button);
  return entry;
}

export function mountToc(root: HTMLElement, handlers: TocHandlers): TocView {
  const title = document.createElement('div');
  title.className = 'toc-title';
  title.textContent = TITLE;
  const list = document.createElement('ul');
  list.className = 'toc-list';
  root.replaceChildren(title, list);

  let last: TocModel | null = null;
  let shown = '';

  return {
    update(model) {
      if (
        last !== null && last.frame === model.frame && last.wordingsVersion === model.wordingsVersion
        && last.churn === model.churn && last.answerParaId === model.answerParaId
      ) return;
      last = model;
      // While some of a frame's texts are missing, its headings cannot be told from paragraphs. The list
      // is kept as it was, dimmed, so it is never taken for the contents at the playhead.
      const waiting = model.frame !== null && model.frame.blocks.some((block) => model.cache.get(block.hash) === undefined);
      list.classList.toggle('pending', waiting);
      if (waiting) return;
      const rows = model.frame === null ? [] : rowsOf(model, model.frame);
      // Most frames of a scrub leave the headings as they were: the list is rebuilt only when it differs.
      const signature = JSON.stringify(rows);
      if (signature === shown) return;
      shown = signature;
      list.replaceChildren(...rows.map((row) => item(row, handlers)));
    },
  };
}
