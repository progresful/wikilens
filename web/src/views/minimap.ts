// The overview strip beside the article: every block as one bar, tinted like the page, the
// answer marked, and a box over the bars of what is in view. A short article leaves the strip
// partly empty, so it visibly grows as the playhead moves forward. Pressing or dragging on
// the strip moves the article.
import { barWidthPercent, blockAt, minimapPitch } from '../minimap';
import type { Pitch, Span } from '../minimap';
import { churnLevel } from '../time';
import type { Frame, FrameBlock, Wording } from '../types';
import type { WordingCache } from '../wordingCache';

export interface MinimapModel {
  frame: Frame | null;
  cache: WordingCache;
  wordingsVersion: number;
  /** Distinct wordings per paragraph for the tint, or null while a question is active. */
  churn: Readonly<Record<string, number>> | null;
  answerParaId: number | null;
}

export interface MinimapHandlers {
  /** The strip was pressed: the article is about to be moved by hand. */
  onGrab: () => void;
  /** Bring a block into view: its index in reading order, and how far down it (0 to 1). */
  onJump: (index: number, within: number) => void;
}

export interface MinimapView {
  update(model: MinimapModel): void;
  /** The blocks now in view in the article, or null when there is nothing to show. */
  setView(span: Span | null): void;
}

const MIN_VIEW_PX = 6;

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function barClass(block: FrameBlock, wording: Wording | undefined, model: MinimapModel): string {
  const names = ['mm-bar'];
  const isHeading = wording?.kind === 'h';
  if (isHeading) names.push('mm-heading');
  const wordings = model.churn?.[String(block.paraId)];
  if (wordings !== undefined && !isHeading) names.push(`churn-${churnLevel(wordings)}`);
  if (block.paraId === model.answerParaId) names.push('mm-answer');
  return names.join(' ');
}

export function mountMinimap(root: HTMLElement, handlers: MinimapHandlers): MinimapView {
  const count = document.createElement('span');
  count.className = 'mm-count';
  const map = div('mm-map');
  const inner = div('mm-inner');
  const bars = div('mm-bars');
  const view = div('mm-view');
  view.hidden = true;
  inner.append(bars, view);
  map.append(inner);
  root.replaceChildren(count, map);

  let last: MinimapModel | null = null;
  let height = 0;                              // of the strip, kept from the last resize so drawing reads no layout
  let scale: Pitch = minimapPitch(0, 0);
  let blockCount = 0;
  let span: Span | null = null;

  function placeView(): void {
    view.hidden = span === null || blockCount === 0;
    if (span === null) return;
    view.style.top = `${span.from * scale.pitch}px`;
    view.style.height = `${Math.max(MIN_VIEW_PX, (span.to - span.from) * scale.pitch)}px`;
  }

  function draw(model: MinimapModel): void {
    const blocks = model.frame?.blocks ?? [];
    blockCount = blocks.length;
    scale = minimapPitch(blockCount, height);
    const wordings = blocks.map((block) => model.cache.get(block.hash));
    count.textContent = model.frame === null ? '' : `${wordings.filter((wording) => wording?.kind !== 'h').length} ¶`;
    bars.replaceChildren(...blocks.map((block, index) => {
      const wording = wordings[index];
      const bar = document.createElement('i');
      bar.className = barClass(block, wording, model);
      bar.style.top = `${index * scale.pitch}px`;
      bar.style.height = `${scale.bar}px`;
      bar.style.width = `${barWidthPercent(wording?.text.length)}%`;
      return bar;
    }));
    placeView();
  }

  new ResizeObserver(() => {
    height = inner.clientHeight;
    if (last !== null) draw(last);
  }).observe(inner);

  let pressing = false;
  const jump = (event: PointerEvent): void => {
    const spot = blockAt(event.clientY - inner.getBoundingClientRect().top, scale.pitch, blockCount);
    if (spot !== null) handlers.onJump(spot.index, spot.within);
  };
  map.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;            // the main button only: a context menu is not a drag
    map.setPointerCapture(event.pointerId);
    pressing = true;
    handlers.onGrab();
    jump(event);
  });
  map.addEventListener('pointermove', (event) => {
    if (pressing) jump(event);
  });
  const release = (): void => {
    pressing = false;
  };
  map.addEventListener('pointerup', release);
  map.addEventListener('pointercancel', release);
  map.addEventListener('lostpointercapture', release);

  return {
    update(model) {
      if (
        last !== null && last.frame === model.frame && last.wordingsVersion === model.wordingsVersion
        && last.churn === model.churn && last.answerParaId === model.answerParaId
      ) return;
      last = model;
      draw(model);
    },
    setView(next) {
      span = next;
      placeView();
    },
  };
}
