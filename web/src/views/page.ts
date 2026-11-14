// The article page: the blocks of one frame, in reading order. Elements are kept per
// paragraph and reused from frame to frame, so a scrub only touches what changed.
// Article text is always written with textContent: it is never interpreted as markup.
import { churnLevel, formatDate } from '../time';
import type { Frame, Wording } from '../types';
import type { WordingCache } from '../wordingCache';

export interface PageModel {
  title: string;
  firstTs: number;
  frame: Frame | null;
  cache: WordingCache;
  wordingsVersion: number;
  /** Distinct wordings per paragraph for the tint, or null while a question is active. */
  churn: Readonly<Record<string, number>> | null;
  /** The tracked paragraph: its text belongs to the answer view, not to the frame. */
  answerParaId: number | null;
}

export interface PageView {
  update(model: PageModel): void;
  /** The element of a paragraph currently on the page. */
  elementFor(paraId: number): HTMLElement | null;
  readonly blocks: HTMLElement;
}

const KIND_CLASSES = ['kind-p', 'kind-li', 'kind-h'] as const;
const CHURN_CLASSES = ['churn-1', 'churn-2', 'churn-3', 'churn-4', 'churn-5'] as const;

function applyWording(element: HTMLElement, hash: string, wording: Wording | undefined, ownsText: boolean): void {
  if (wording === undefined) {
    element.classList.add('pending');
    return;
  }
  if (element.dataset.hash === hash && !element.classList.contains('pending')) return;
  element.classList.remove('pending', ...KIND_CLASSES);
  element.classList.add(`kind-${wording.kind}`);
  element.dataset.hash = hash;
  if (ownsText) element.textContent = wording.text;
}

function applyChurn(element: HTMLElement, wordings: number | undefined, tinted: boolean): void {
  const wanted = tinted && wordings !== undefined && !element.classList.contains('kind-h')
    ? `churn-${churnLevel(wordings)}`
    : null;
  for (const name of CHURN_CLASSES) element.classList.toggle(name, name === wanted);
}

export function mountPage(root: HTMLElement): PageView {
  const heading = document.createElement('h1');
  const empty = document.createElement('p');
  empty.className = 'page-empty';
  empty.hidden = true;
  const blocks = document.createElement('div');
  blocks.className = 'blocks';
  root.replaceChildren(heading, empty, blocks);

  const elements = new Map<number, HTMLElement>();
  let last: PageModel | null = null;

  function update(model: PageModel): void {
    if (
      last !== null && last.frame === model.frame && last.wordingsVersion === model.wordingsVersion
      && last.churn === model.churn && last.answerParaId === model.answerParaId && last.title === model.title
    ) return;
    last = model;
    heading.textContent = model.title;
    const frame = model.frame;
    if (frame === null) return;

    const wanted = new Set(frame.blocks.map((block) => block.paraId));
    for (const [paraId, element] of elements) {
      if (!wanted.has(paraId)) {
        element.remove();
        elements.delete(paraId);
      }
    }
    let cursor: Element | null = blocks.firstElementChild;
    for (const block of frame.blocks) {
      let element = elements.get(block.paraId);
      if (element === undefined) {
        element = document.createElement('div');
        element.className = 'para';
        element.dataset.paraId = String(block.paraId);
        elements.set(block.paraId, element);
      }
      while (cursor !== null && cursor.classList.contains('ghost')) cursor = cursor.nextElementSibling;
      if (cursor === element) {
        cursor = cursor.nextElementSibling;
      } else {
        blocks.insertBefore(element, cursor);
      }
      const isAnswer = block.paraId === model.answerParaId;
      applyWording(element, block.hash, model.cache.get(block.hash), !isAnswer);
      applyChurn(element, model.churn?.[String(block.paraId)], model.churn !== null);
    }
    empty.hidden = frame.blocks.length > 0;
    if (frame.blocks.length === 0) {
      empty.textContent = frame.t < model.firstTs
        ? `This article did not exist yet. Its first revision was saved on ${formatDate(model.firstTs)}.`
        : 'The article had no text at this moment.';
    }
  }

  return { update, elementFor: (paraId) => elements.get(paraId) ?? null, blocks };
}
