// The scrub controller: owns the playhead time, asks the server for the page at that time,
// and plays through history.
//
// Two rules keep scrubbing instant:
//   - onTime is called synchronously on every move, so whatever can be drawn from data
//     already in the browser (the answer's wording) never waits for the network.
//   - At most one frame request is in flight. While it is, only the newest wanted time is
//     remembered; when it returns, that one is asked for. Nothing queues up, and a fast drag
//     cannot starve the page the way aborting on every move would.
import type { Frame, Segment, TimeRange } from './types';

export const PLAY_DURATION_MS = 13_000;      // an article's whole history plays in this long, plus holds
export const DWELL_MS = 1_100;               // hold on each change of the answer
export const DWELL_REVERTED_MS = 1_700;      // hold longer on a wording that was reverted
export const DWELL_BUDGET_MS = 15_000;       // all holds of one play together; with many changes each hold shrinks

export interface ScrubDeps {
  fetchFrame: (pageId: number, t: number, signal: AbortSignal) => Promise<Frame>;
  onTime: (t: number) => void;
  onFrame: (frame: Frame) => void;
  /** An error when a frame request fails; null when one succeeds after a failure. */
  onError: (error: Error | null) => void;
  requestFrame?: (callback: (now: number) => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface Scrubber {
  open(pageId: number, range: TimeRange): void;
  seek(t: number): void;
  play(segments: readonly Segment[]): void;
  pause(): void;
  readonly playing: boolean;
  readonly time: number;
  dispose(): void;
}

interface Change {
  start: number;
  reverted: boolean;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createScrubber(deps: ScrubDeps): Scrubber {
  const requestFrame = deps.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = deps.cancelFrame ?? ((id) => cancelAnimationFrame(id));

  let page: { id: number; range: TimeRange } | null = null;
  let time = 0;
  let generation = 0;                          // bumped when the article changes; stale answers are ignored
  let inFlight: AbortController | null = null;
  let pending: number | null = null;
  let failing = false;

  let playing = false;
  let frameId: number | null = null;
  let lastClock: number | null = null;
  let dwellUntil = 0;
  let changes: Change[] = [];
  let dwellScale = 1;

  function request(t: number): void {
    if (page === null) return;
    if (inFlight !== null) {
      pending = t;
      return;
    }
    const asked = generation;
    const controller = new AbortController();
    inFlight = controller;
    deps.fetchFrame(page.id, t, controller.signal).then(
      (frame) => {
        if (asked !== generation) return;
        if (failing) {
          failing = false;
          deps.onError(null);
        }
        deps.onFrame(frame);
      },
      (error: unknown) => {
        if (asked !== generation || isAbort(error)) return;
        failing = true;
        deps.onError(error instanceof Error ? error : new Error(String(error)));
      },
    ).finally(() => {
      if (asked !== generation) return;
      inFlight = null;
      if (pending !== null) {
        const next = pending;
        pending = null;
        request(next);
      }
    });
  }

  function moveTo(t: number): void {
    if (page === null) return;
    // Whole milliseconds: the API takes an integer, and a fraction of a millisecond means nothing here.
    time = Math.round(Math.min(page.range.end, Math.max(page.range.first, t)));
    deps.onTime(time);
    request(time);
  }

  function stopClock(): void {
    playing = false;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
  }

  function dropRequests(): void {
    generation += 1;
    inFlight?.abort();
    inFlight = null;
    pending = null;
    failing = false;
  }

  function tick(now: number): void {
    frameId = null;
    if (!playing || page === null) return;
    const elapsed = lastClock === null ? 0 : now - lastClock;
    lastClock = now;
    if (now >= dwellUntil && elapsed > 0) {
      const speed = (page.range.end - page.range.first) / PLAY_DURATION_MS;
      let next = time + elapsed * speed;
      const upcoming = changes.find((change) => change.start > time);
      if (upcoming !== undefined && next >= upcoming.start) {
        next = upcoming.start;
        dwellUntil = now + (upcoming.reverted ? DWELL_REVERTED_MS : DWELL_MS) * dwellScale;
      }
      if (next >= page.range.end) {
        stopClock();                 // before the last move, so a listener sees `playing` already false
        moveTo(page.range.end);
        return;
      }
      moveTo(next);
    }
    frameId = requestFrame(tick);
  }

  return {
    open(pageId, range) {
      stopClock();
      dropRequests();
      page = { id: pageId, range };
      time = range.end;
    },
    seek(t) {
      stopClock();
      moveTo(t);
    },
    play(segments) {
      if (page === null) return;
      stopClock();
      if (time >= page.range.end) moveTo(page.range.first);
      changes = segments
        .map((segment) => ({ start: segment.start, reverted: segment.reverted }))
        .sort((a, b) => a.start - b.start);
      const fullHolds = changes.reduce((sum, change) => sum + (change.reverted ? DWELL_REVERTED_MS : DWELL_MS), 0);
      dwellScale = Math.min(1, DWELL_BUDGET_MS / Math.max(1, fullHolds));
      playing = true;
      lastClock = null;
      dwellUntil = 0;
      frameId = requestFrame(tick);
    },
    pause: stopClock,
    get playing() {
      return playing;
    },
    get time() {
      return time;
    },
    dispose() {
      stopClock();
      dropRequests();
      page = null;
    },
  };
}
