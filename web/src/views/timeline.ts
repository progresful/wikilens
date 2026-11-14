// The timeline: every edit as faint bars, the answer's wordings as a band, and the playhead.
import { timeToX, yearLabelStep } from '../time';
import type { Overview, Segment, TimeRange } from '../types';

export interface TimelineModel {
  range: TimeRange | null;
  bars: Overview['bars'] | null;
  segments: readonly Segment[];
  time: number;
  /** The wording closest to the question: its stretches of the band are marked. */
  closestHash: string | null;
}

export interface TimelineHandlers {
  /** The pointer is down at `x` pixels from the left edge of a track `width` pixels wide. */
  onSeek: (x: number, width: number) => void;
}

export interface TimelineView {
  update(model: TimelineModel): void;
  readonly track: HTMLElement;
}

const MONTH_MS = 30.44 * 86_400_000;

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function percent(t: number, range: TimeRange): string {
  return `${timeToX(t, range, 100)}%`;
}

function monthStart(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1);
}

function barElements(bars: Overview['bars'], range: TimeRange): HTMLElement[] {
  const peak = Math.max(1, ...bars.map((bar) => bar.edits));
  const width = (MONTH_MS / (range.end - range.first)) * 100 * 0.8;
  return bars.map((bar) => {
    const element = div('bar');
    element.style.left = percent(monthStart(bar.month), range);
    element.style.width = `${width}%`;
    element.style.height = `${Math.max(6, Math.sqrt(bar.edits / peak) * 100)}%`;   // square root: quiet months stay visible
    return element;
  });
}

function segmentElements(segments: readonly Segment[], range: TimeRange, closestHash: string | null): HTMLElement[] {
  const tones = Math.max(1, ...segments.map((segment) => segment.tone));
  return segments.map((segment) => {
    const element = div(segment.kind === 'gap' ? 'seg gap' : `seg tone-${segment.tone}`);
    if (segment.reverted) element.classList.add('reverted');
    if (segment.loose) element.classList.add('loose');
    if (closestHash !== null && segment.hash === closestHash) element.classList.add('closest');
    element.style.left = percent(segment.start, range);
    element.style.width = `${((segment.end - segment.start) / (range.end - range.first)) * 100}%`;
    if (segment.kind === 'wording' && !segment.reverted) {
      element.style.opacity = String(0.25 + 0.75 * (segment.tone / tones));   // brighter = later wording
    }
    return element;
  });
}

function tickElements(segments: readonly Segment[], range: TimeRange): HTMLElement[] {
  return segments.map((segment) => {
    const element = div('tick');
    if (segment.reverted) element.classList.add('reverted');
    if (segment.loose) element.classList.add('loose');
    if (segment.kind === 'gap') element.classList.add('gap');
    element.style.left = percent(segment.start, range);
    return element;
  });
}

function yearElements(range: TimeRange, widthPx: number): HTMLElement[] {
  const firstYear = new Date(range.first).getUTCFullYear();
  const lastYear = new Date(range.end).getUTCFullYear();
  const step = yearLabelStep(lastYear - firstYear + 1, widthPx);
  const labels: HTMLElement[] = [];
  for (let year = firstYear; year <= lastYear; year += step) {
    const label = document.createElement('span');
    label.className = 'year-label';
    label.textContent = String(year);
    label.style.left = percent(Math.max(range.first, Date.UTC(year, 0, 1)), range);
    labels.push(label);
  }
  return labels;
}

export function mountTimeline(root: HTMLElement, handlers: TimelineHandlers): TimelineView {
  const track = div('track');
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'moment in the article\'s history');
  const bars = div('bars');
  const band = div('segs');
  const ticks = div('ticks');
  const playhead = div('playhead');
  const years = div('years');
  track.append(bars, band, ticks, playhead);
  root.replaceChildren(track, years);

  let dragging = false;
  const seekFrom = (event: PointerEvent): void => {
    const box = track.getBoundingClientRect();
    handlers.onSeek(event.clientX - box.left, box.width);
  };
  track.addEventListener('pointerdown', (event) => {
    track.setPointerCapture(event.pointerId);
    dragging = true;
    seekFrom(event);
  });
  track.addEventListener('pointermove', (event) => {
    if (dragging) seekFrom(event);
  });
  const stop = (): void => {
    dragging = false;
  };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);

  let last: TimelineModel | null = null;
  let width = 0;                 // of the track, kept from its last resize so drawing reads no layout

  // A narrower timeline (a phone, a turned tablet) has room for fewer year labels.
  new ResizeObserver(() => {
    const measured = track.clientWidth;
    if (measured === width) return;
    width = measured;
    if (last !== null && last.range !== null) years.replaceChildren(...yearElements(last.range, width));
  }).observe(track);

  function update(model: TimelineModel): void {
    const range = model.range;
    if (range === null) return;
    const rangeChanged = last === null || last.range !== range;
    if (rangeChanged || last?.bars !== model.bars) {
      if (width === 0) width = track.clientWidth;      // the first draw can come before the first resize is reported
      bars.replaceChildren(...barElements(model.bars ?? [], range));
      years.replaceChildren(...yearElements(range, width));
    }
    if (rangeChanged || last?.segments !== model.segments || last.closestHash !== model.closestHash) {
      band.replaceChildren(...segmentElements(model.segments, range, model.closestHash));
      ticks.replaceChildren(...tickElements(model.segments, range));
    }
    playhead.style.left = percent(model.time, range);
    track.setAttribute('aria-valuenow', String(model.time));
    last = model;
  }

  return { update, track };
}
