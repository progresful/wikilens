// The article page: the blocks of one frame, in reading order. Elements are kept per
// paragraph and reused from frame to frame, so a scrub only touches what changed.
// Article text is always written with textContent: it is never interpreted as markup.
import type { Box } from '../minimap';
import { churnLevel, formatDate } from '../time';
import type { Frame, Wording } from '../types';
import type { WordingCache } from '../wordingCache';

export interface PageModel {
  pageId: number;
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
  /**
   * The element of the tracked paragraph. It keeps its place on the page while the paragraph
   * is out of the frame (removed for a period, or the frame has not caught up yet); if the
   * paragraph has never been on the page, an element is made for it at the top.
   */
  answerElement(paraId: number): HTMLElement;
  /** The element of a block that is on the page now, for scrolling to it. */
  blockElement(paraId: number): HTMLElement | undefined;
  /** Where each block of the frame sits in the scrolling article, in reading order. Reads layout. */
  blockBoxes(): Box[];
  readonly blocks: HTMLElement;
}

const KIND_CLASSES = ['kind-p', 'kind-li', 'kind-h'] as const;
const CHURN_CLASSES = ['churn-1', 'churn-2', 'churn-3', 'churn-4', 'churn-5'] as const;

function applyWording(element: HTMLElement, hash: string, wording: Wording | undefined, ownsText: boolean): void {
  if (wording === undefined) {
    if (ownsText) element.classList.add('pending');
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

/** A paragraph that is no longer the tracked one goes back to being ordinary page text. */
function releaseAnswer(element: HTMLElement): void {
  element.classList.remove('answer', 'ghost', 'reverted', 'loose');
  element.hidden = false;
  delete element.dataset.tracked;
  element.replaceChildren();
  delete element.dataset.hash;       // so its text is written again from the frame
}

export function mountPage(root: HTMLElement, heading: HTMLElement): PageView {
  const empty = document.createElement('p');
  empty.className = 'page-empty';
  empty.hidden = true;
  const blocks = document.createElement('div');
  blocks.className = 'blocks';
  root.replaceChildren(empty, blocks);

  const elements = new Map<number, HTMLElement>();
  let last: PageModel | null = null;

  function update(model: PageModel): void {
    if (
      last !== null && last.frame === model.frame && last.wordingsVersion === model.wordingsVersion
      && last.churn === model.churn && last.answerParaId === model.answerParaId && last.title === model.title
      && last.pageId === model.pageId
    ) return;
    if (last === null || last.pageId !== model.pageId) {
      // Another article: nothing of the previous one may stay, whatever state its elements were in.
      elements.clear();
      blocks.replaceChildren();
      empty.hidden = true;
    }
    last = model;
    heading.textContent = model.title;
    const frame = model.frame;
    if (frame === null) return;

    const wanted = new Set(frame.blocks.map((block) => block.paraId));
    for (const [paraId, element] of elements) {
      if (paraId !== model.answerParaId && element.dataset.tracked === '1') releaseAnswer(element);
      if (wanted.has(paraId)) {
        delete element.dataset.absent;
      } else if (paraId === model.answerParaId) {
        element.dataset.absent = '1';     // stays where it was, for the answer view to show as gone
      } else {
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
      while (cursor instanceof HTMLElement && cursor.dataset.absent === '1') cursor = cursor.nextElementSibling;
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

  function answerElement(paraId: number): HTMLElement {
    const existing = elements.get(paraId);
    if (existing !== undefined) {
      existing.dataset.tracked = '1';
      return existing;
    }
    const element = document.createElement('div');
    element.className = 'para';
    element.dataset.paraId = String(paraId);
    element.dataset.absent = '1';
    element.dataset.tracked = '1';
    elements.set(paraId, element);
    blocks.prepend(element);
    return element;
  }

  function blockElement(paraId: number): HTMLElement | undefined {
    const element = elements.get(paraId);
    return element === undefined || element.dataset.absent === '1' ? undefined : element;
  }

  function blockBoxes(): Box[] {
    let bottom = 0;      // a block that is not drawn takes no room, just under the block before it
    return (last?.frame?.blocks ?? []).map((block) => {
      const element = elements.get(block.paraId);
      if (element === undefined || element.hidden) return { top: bottom, height: 0 };
      bottom = element.offsetTop + element.offsetHeight;
      return { top: element.offsetTop, height: element.offsetHeight };
    });
  }

  return { update, answerElement, blockElement, blockBoxes, blocks };
}
