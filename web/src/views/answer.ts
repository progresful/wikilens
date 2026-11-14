// The tracked paragraph: its wording at the playhead, drawn from the history already in the
// browser, so it changes the moment the playhead moves and never waits for the network.
import { quote, standing, thenAndNow } from '../closest';
import type { ThenAndNow, WordChange } from '../closest';
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
  /**
   * The page around the answer changed size (its text arrived late, or words are still growing in):
   * put the answer back in view, unless the reader has moved the article by hand since.
   */
  settle(): void;
  /** The reader moved the article themselves: leave it there until the playhead moves again. */
  letGo(): void;
}

interface Parts {
  paraId: number;
  element: HTMLElement;
  label: HTMLElement;
  life: HTMLElement;
  link: HTMLAnchorElement;
  notice: HTMLElement;
  morph: MorphView;
  then: ThenParts;
}

/** "Then and now": the box pointing at the wording closest to the question, and the line pointing back. */
interface ThenParts {
  box: HTMLElement;
  life: HTMLElement;
  quote: HTMLElement;
  change: HTMLElement;
  jump: HTMLButtonElement;
  here: HTMLElement;
  later: HTMLElement;
  laterText: HTMLElement;
  latest: HTMLButtonElement;
}

const REVISION_URL = 'https://fi.wikipedia.org/?oldid=';
const TOP_MARGIN_PX = 12;
const GLIDE_LIMIT_MS = 2500;   // a glide that has not reported its end by now is taken to be over
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

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function changeLine(change: WordChange | null): string {
  if (change === null) return 'The paragraph is not in the article at this moment.';
  if (change.gone === 0 && change.added === 0) return 'The wording shown below differs only in its punctuation.';
  return `The wording shown below differs: ${plural(change.gone, 'word')} gone, ${change.added} new.`;
}

/** When the article read like the closest wording: one stretch with its length, or the span of several. */
function thenLife(found: ThenAndNow, corpusEnd: number): string {
  if (found.stretches === 1) {
    return `${lifeLine(found.closest, corpusEnd)}${found.closest.reverted ? ` · ${found.closest.label}` : ''}`;
  }
  const until = found.until >= corpusEnd ? 'corpus end' : formatDate(found.until);
  return `first ${formatDate(found.closest.start)}, last until ${until} · stood ${found.stretches} times`;
}

/** What became of the closest wording, said from the moment it is on screen; empty when it still stands. */
function laterLine(closest: Segment, segments: readonly Segment[], corpusEnd: number): string {
  const last = segments[segments.length - 1];
  if (last === undefined || last.hash === closest.hash) return '';
  const { stretches, until } = standing(segments, closest.hash);
  const stood = stretches > 1 ? `It stood ${stretches} times, last until ${formatDate(until)}.`
    : `It stood until ${formatDate(until)}.`;
  const fate = last.kind === 'gap' ? 'is no longer in the article' : 'reads differently';
  return `${stood} On ${formatDate(corpusEnd)} the paragraph ${fate}.`;
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
  let closestStart = 0;       // where "show the closest wording" goes
  let latestTime = 0;         // where "show the latest" goes: the end of the corpus

  function buildThen(): ThenParts {
    const box = make('div', 'closest-match');
    const head = make('div', 'closest-head');
    const label = make('span', 'closest-label');
    label.textContent = 'Closest to your question';
    const life = make('span', 'closest-life');
    head.append(label, life);
    const text = make('blockquote', 'closest-quote');
    const foot = make('div', 'closest-foot');
    const change = make('span', 'closest-change');
    const go = make('button', 'closest-jump');
    go.type = 'button';
    go.addEventListener('click', () => handlers.onJump(closestStart));
    foot.append(change, go);
    box.append(head, text, foot);
    const here = make('span', 'closest-here');
    here.textContent = 'closest to your question';
    const later = make('div', 'closest-later');
    const laterText = make('span', 'closest-later-text');
    const latest = make('button', 'closest-latest');
    latest.type = 'button';
    latest.addEventListener('click', () => handlers.onJump(latestTime));
    later.append(laterText, latest);
    return { box, life, quote: text, change, jump: go, here, later, laterText, latest };
  }

  function showThen(parts: ThenParts, found: ThenAndNow | null, segments: readonly Segment[], index: number, model: AnswerModel): void {
    parts.box.hidden = found === null;
    if (found !== null) {
      closestStart = found.closest.start;
      parts.life.textContent = thenLife(found, model.corpusEnd);
      parts.quote.textContent = quote(found.closest.text ?? '');
      parts.change.textContent = changeLine(found.change);
      parts.jump.textContent = `Show ${formatDate(found.closest.start)}`;
    }
    const shown = segments[index];
    const isClosest = shown !== undefined && shown.kind === 'wording' && shown.hash === model.tracked?.closestHash;
    const fate = isClosest ? laterLine(shown, segments, model.corpusEnd) : '';
    parts.here.hidden = !isClosest;
    parts.later.hidden = fate === '';
    parts.laterText.textContent = fate;
    latestTime = model.corpusEnd;
    parts.latest.textContent = `Show ${formatDate(model.corpusEnd)}`;
  }

  let parts: Parts | null = null;
  let shownSegments: readonly Segment[] | null = null;
  let shownIndex: number | null = null;
  let shownTokens: readonly string[] | null = null;
  let lastTime: number | null = null;
  let held = false;            // the view is where this code put it, not where the reader did
  let gliding = false;         // the page is on its way to a newly asked answer
  let settleWanted = false;    // something changed size during the glide
  let glideLimit: number | null = null;

  // A glide across a long article takes as long as the browser decides. Correcting the position
  // while it is still under way leaves the view tens of pixels off, so a correction asked for during
  // a glide waits until the browser says the scrolling has ended.
  function glideEnded(): void {
    if (!gliding) return;
    gliding = false;
    if (glideLimit !== null) window.clearTimeout(glideLimit);
    glideLimit = null;
    if (settleWanted) settle();
  }
  scroller.addEventListener('scrollend', glideEnded);

  // Anything the reader does to the article with a hand takes it out of this code's keeping.
  const byHand = (): void => {
    held = false;
  };
  scroller.addEventListener('wheel', byHand, { passive: true });
  scroller.addEventListener('touchmove', byHand, { passive: true });
  scroller.addEventListener('pointerdown', byHand);

  function build(paraId: number): Parts {
    const element = page.answerElement(paraId);
    const meta = make('div', 'answer-meta');
    const label = make('span', 'answer-label');
    const life = make('span', 'answer-life');
    const link = make('a', 'answer-link');
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'this revision on Wikipedia ↗';
    const then = buildThen();
    meta.append(label, then.here, life, link);
    const text = make('div', 'answer-text');
    const notice = make('div', 'answer-notice');
    element.replaceChildren(then.box, meta, text, then.later, notice);
    return { paraId, element, label, life, link, notice, morph: mountMorph(text), then };
  }

  function centre(smooth: boolean): void {
    if (parts === null || parts.element.hidden) return;
    // Centre the answer; if it is taller than the view, show its top, where its label is.
    const room = scroller.clientHeight - parts.element.offsetHeight;
    const top = parts.element.offsetTop - (room > 2 * TOP_MARGIN_PX ? room / 2 : TOP_MARGIN_PX);
    const target = Math.max(0, top);
    // A glide only when there is somewhere to go: no scrolling means no end of scrolling to wait for.
    gliding = smooth && Math.abs(scroller.scrollTop - target) > 1;
    settleWanted = false;
    if (glideLimit !== null) window.clearTimeout(glideLimit);
    glideLimit = gliding ? window.setTimeout(glideEnded, GLIDE_LIMIT_MS) : null;   // for browsers that never say
    scroller.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'instant' });
    held = true;
  }

  function settle(): void {
    if (!held || parts === null) return;
    if (gliding) settleWanted = true;
    else centre(false);
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
    showThen(current.then, thenAndNow(segments, index, model.tracked?.closestHash ?? null), segments, index, model);
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
      held = false;
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

  return { update, settle, letGo: byHand };
}
