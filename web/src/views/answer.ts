// The tracked paragraph: its wording at the playhead, drawn from the history already in the
// browser, so it changes the moment the playhead moves and never waits for the network.
import { tokenize } from '../diff';
import type { Tracked } from '../state';
import { formatDate, formatSpan, segmentIndexAt } from '../time';
import type { Segment } from '../types';
import { mountMorph } from './morph';
import type { MorphView } from './morph';
import type { PageView } from './page';

export interface AnswerModel {
  tracked: Tracked | null;
  time: number;
  corpusEnd: number;
  /** The question matched this paragraph only weakly. */
  weak: boolean;
}

export interface AnswerHandlers {
  onJump: (t: number) => void;
}

export interface AnswerView {
  update(model: AnswerModel): void;
}

interface Parts {
  paraId: number;
  element: HTMLElement;
  label: HTMLElement;
  life: HTMLElement;
  link: HTMLAnchorElement;
  notice: HTMLElement;
  morph: MorphView;
}

const REVISION_URL = 'https://fi.wikipedia.org/?oldid=';
const WEAK_NOTICE = 'weak match: nothing in this article matches the question well; this is the closest paragraph.';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function lifeLine(segment: Segment, corpusEnd: number): string {
  const until = segment.end >= corpusEnd ? 'corpus end' : formatDate(segment.end);
  return `${formatDate(segment.start)} → ${until} · ${formatSpan(segment.end - segment.start)}`;
}

function noticeFor(segment: Segment, corpusEnd: number, weak: boolean): string {
  if (segment.kind === 'gap') {
    return segment.end >= corpusEnd
      ? `This paragraph was removed on ${formatDate(segment.start)} and had not come back by the end of the corpus.`
      : `This paragraph was removed on ${formatDate(segment.start)} and came back on ${formatDate(segment.end)}.`;
  }
  if (segment.reverted) {
    return `This wording was reverted after ${formatSpan(segment.end - segment.start)}. It is part of the history, so it is shown.`;
  }
  return weak ? WEAK_NOTICE : '';
}

export function mountAnswer(page: PageView, scroller: HTMLElement, handlers: AnswerHandlers): AnswerView {
  const pinned = make('div', 'pinned-notice');
  pinned.hidden = true;
  const pinnedText = make('span', 'first-appearance');
  const jump = make('button', 'jump');
  jump.type = 'button';
  jump.textContent = 'jump there';
  pinnedText.append(document.createTextNode(''), ' ', jump);
  pinned.append(pinnedText);
  scroller.prepend(pinned);
  let jumpTo = 0;
  jump.addEventListener('click', () => handlers.onJump(jumpTo));

  let parts: Parts | null = null;
  let shownSegments: readonly Segment[] | null = null;
  let shownIndex: number | null = null;
  let shownTokens: readonly string[] | null = null;
  let lastTime: number | null = null;

  function build(paraId: number): Parts {
    const element = page.answerElement(paraId);
    const meta = make('div', 'answer-meta');
    const label = make('span', 'answer-label');
    const life = make('span', 'answer-life');
    const link = make('a', 'answer-link');
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'this revision on Wikipedia ↗';
    meta.append(label, life, link);
    const text = make('div', 'answer-text');
    const notice = make('div', 'answer-notice');
    element.replaceChildren(meta, text, notice);
    return { paraId, element, label, life, link, notice, morph: mountMorph(text) };
  }

  function centre(smooth: boolean): void {
    if (parts === null || parts.element.hidden) return;
    const top = parts.element.offsetTop - (scroller.clientHeight - parts.element.offsetHeight) / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'instant' });
  }

  function show(current: Parts, segments: readonly Segment[], index: number, model: AnswerModel): void {
    const segment = segments[index];
    if (segment === undefined) return;
    const previous = segments[index - 1];
    const isGap = segment.kind === 'gap';
    const tokens = tokenize((isGap ? previous?.text : segment.text) ?? '');
    if (shownTokens === null || isGap) current.morph.set(tokens);
    else current.morph.update(shownTokens, tokens);
    shownTokens = tokens;

    current.element.classList.toggle('ghost', isGap);
    current.element.classList.toggle('reverted', segment.reverted);
    current.element.classList.toggle('loose', segment.loose);
    current.label.textContent = segment.label;
    current.label.className = `answer-label${segment.reverted ? ' reverted' : ''}${isGap ? ' gap' : ''}${segment.loose ? ' loose' : ''}`;
    current.life.textContent = lifeLine(segment, model.corpusEnd);
    const revision = isGap ? previous?.revId : segment.revId;
    current.link.hidden = revision === null || revision === undefined;
    if (revision !== null && revision !== undefined) current.link.href = `${REVISION_URL}${revision}`;
    current.notice.textContent = noticeFor(segment, model.corpusEnd, model.weak);
  }

  function update(model: AnswerModel): void {
    const tracked = model.tracked;
    if (tracked === null) {
      parts = null;          // the page view has already turned the element back into ordinary text
      shownSegments = null;
      shownIndex = null;
      shownTokens = null;
      lastTime = null;
      pinned.hidden = true;
      return;
    }
    const changedParagraph = parts === null || parts.paraId !== tracked.paraId || shownSegments !== tracked.segments;
    if (parts === null || parts.paraId !== tracked.paraId) {
      parts = build(tracked.paraId);
      shownTokens = null;
    }
    if (changedParagraph) {
      shownSegments = tracked.segments;
      shownIndex = null;
    }
    const index = segmentIndexAt(tracked.segments, model.time);
    const first = tracked.segments[0];
    const before = index === -1;
    parts.element.hidden = before;
    parts.element.classList.toggle('answer', !before);
    pinned.hidden = !before;
    if (before) {
      if (first !== undefined) {
        jumpTo = first.start;
        (pinnedText.firstChild as Text).data = `This paragraph first appears on ${formatDate(first.start)}.`;
      }
      shownIndex = null;
      shownTokens = null;
    } else if (index !== shownIndex) {
      show(parts, tracked.segments, index, model);
      shownIndex = index;
    }
    if (changedParagraph || model.time !== lastTime) centre(changedParagraph);
    lastTime = model.time;
  }

  return { update };
}
