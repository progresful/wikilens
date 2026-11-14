import { describe, expect, it } from 'vitest';

import { createScrubber, DWELL_BUDGET_MS, DWELL_MS, DWELL_REVERTED_MS, PLAY_DURATION_MS } from '../src/scrub';
import type { Frame, Segment, TimeRange } from '../src/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Request {
  pageId: number;
  t: number;
  signal: AbortSignal;
  answer: Deferred<Frame>;
}

const frameAt = (t: number): Frame => ({ t, blocks: [], sql: '', dbMs: 0 });
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const seg = (start: number, end: number, reverted = false): Segment => ({
  kind: 'wording', start, end, hash: 'h', text: 't', revId: 1, label: '', tone: 0, loose: false, reverted,
});
// With this range, play moves one unit of time per millisecond of clock.
const range: TimeRange = { first: 0, end: PLAY_DURATION_MS };

function harness() {
  const requests: Request[] = [];
  const times: number[] = [];
  const frames: Frame[] = [];
  const errors: (Error | null)[] = [];
  const cancelled: number[] = [];
  let callback: ((now: number) => void) | null = null;
  let lastId = 0;
  const scrubber = createScrubber({
    fetchFrame: (pageId, t, signal) => {
      const answer = deferred<Frame>();
      requests.push({ pageId, t, signal, answer });
      return answer.promise;
    },
    onTime: (t) => times.push(t),
    onFrame: (frame) => frames.push(frame),
    onError: (error) => errors.push(error),
    requestFrame: (cb) => {
      callback = cb;
      lastId += 1;
      return lastId;
    },
    cancelFrame: (id) => {
      cancelled.push(id);
      callback = null;
    },
  });
  const tick = (now: number): void => {
    const run = callback;
    callback = null;
    run?.(now);
  };
  return { scrubber, requests, times, frames, errors, cancelled, tick, hasFrameScheduled: () => callback !== null };
}

describe('seeking', () => {
  it('calls onTime synchronously, clamped to the range', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(500);
    h.scrubber.seek(-10);
    h.scrubber.seek(PLAY_DURATION_MS + 10);
    expect(h.times).toEqual([500, 0, PLAY_DURATION_MS]);
    expect(h.scrubber.time).toBe(PLAY_DURATION_MS);
  });

  it('does nothing before an article is opened', () => {
    const h = harness();
    h.scrubber.seek(500);
    expect(h.times).toEqual([]);
    expect(h.requests).toHaveLength(0);
  });

  it('keeps one request in flight and remembers only the newest pending time', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(100);
    h.scrubber.seek(200);
    h.scrubber.seek(300);
    expect(h.requests.map((r) => r.t)).toEqual([100]);
    h.requests[0]?.answer.resolve(frameAt(100));
    await settle();
    expect(h.frames.map((f) => f.t)).toEqual([100]);
    expect(h.requests.map((r) => r.t)).toEqual([100, 300]);   // 200 was never requested
    h.requests[1]?.answer.resolve(frameAt(300));
    await settle();
    expect(h.frames.map((f) => f.t)).toEqual([100, 300]);
    expect(h.requests).toHaveLength(2);
  });

  it('reports an error and clears it on the next success', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(100);
    h.requests[0]?.answer.reject(new Error('database unavailable'));
    await settle();
    expect(h.errors.map((e) => e?.message)).toEqual(['database unavailable']);
    h.scrubber.seek(200);
    h.requests[1]?.answer.resolve(frameAt(200));
    await settle();
    expect(h.errors).toHaveLength(2);
    expect(h.errors[1]).toBeNull();
    expect(h.frames.map((f) => f.t)).toEqual([200]);
  });

  it('does not report a success as an error being cleared when there was none', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(100);
    h.requests[0]?.answer.resolve(frameAt(100));
    await settle();
    expect(h.errors).toEqual([]);
  });

  it('keeps calling onTime while requests fail', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    for (const t of [100, 200, 300]) {
      h.scrubber.seek(t);
      h.requests.at(-1)?.answer.reject(new Error('down'));
      await settle();
    }
    expect(h.times).toEqual([100, 200, 300]);
    expect(h.errors).toHaveLength(3);
  });

  it('wraps a rejection that is not an Error', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(100);
    h.requests[0]?.answer.reject('plain text');
    await settle();
    expect(h.errors[0]).toBeInstanceOf(Error);
  });
});

describe('opening another article', () => {
  it('aborts the request in flight and ignores its result', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(100);
    h.scrubber.open(2, range);
    expect(h.requests[0]?.signal.aborted).toBe(true);
    h.requests[0]?.answer.resolve(frameAt(100));
    await settle();
    expect(h.frames).toEqual([]);
    h.scrubber.seek(50);
    expect(h.requests[1]?.pageId).toBe(2);
  });

  it('does not treat the aborted request as a failure', async () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(100);
    h.scrubber.open(2, range);
    h.requests[0]?.answer.reject(new DOMException('aborted', 'AbortError'));
    await settle();
    expect(h.errors).toEqual([]);
  });
});

describe('playing', () => {
  const segments = [seg(0, 2000), seg(2000, 5000), seg(5000, PLAY_DURATION_MS, true)];

  it('advances with the clock and dwells on changes', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(0);
    h.scrubber.play(segments);
    expect(h.scrubber.playing).toBe(true);
    h.tick(0);
    h.tick(1000);
    expect(h.scrubber.time).toBe(1000);
    h.tick(2500);                                   // would pass the change at 2000: lands on it
    expect(h.scrubber.time).toBe(2000);
    h.tick(2500 + DWELL_MS - 1);
    expect(h.scrubber.time).toBe(2000);             // still holding
    h.tick(2500 + DWELL_MS + 99);                   // 100 ms after the last held tick
    expect(h.scrubber.time).toBe(2100);
    h.tick(2500 + DWELL_MS + 4000);                 // lands on the reverted wording at 5000
    expect(h.scrubber.time).toBe(5000);
    h.tick(2500 + DWELL_MS + 4000 + DWELL_REVERTED_MS - 1);
    expect(h.scrubber.time).toBe(5000);             // a reverted wording is held longer
    h.tick(2500 + DWELL_MS + 4000 + DWELL_REVERTED_MS + 9);
    expect(h.scrubber.time).toBe(5010);
  });

  it('stops at the end of the range', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(PLAY_DURATION_MS - 100);
    h.scrubber.play([]);
    h.tick(0);
    h.tick(500);
    expect(h.scrubber.time).toBe(PLAY_DURATION_MS);
    expect(h.scrubber.playing).toBe(false);
    expect(h.hasFrameScheduled()).toBe(false);
  });

  it('has already stopped when it reports the final time', () => {
    const seen: boolean[] = [];
    const scrubber = createScrubber({
      fetchFrame: () => new Promise<Frame>(() => {}),
      onTime: () => seen.push(scrubber.playing),
      onFrame: () => {},
      onError: () => {},
      requestFrame: (cb) => {
        pendingTick = cb;
        return 1;
      },
      cancelFrame: () => {
        pendingTick = null;
      },
    });
    let pendingTick: ((now: number) => void) | null = null;
    const run = (now: number): void => {
      const cb = pendingTick;
      pendingTick = null;
      cb?.(now);
    };
    scrubber.open(1, range);
    scrubber.seek(PLAY_DURATION_MS - 100);
    scrubber.play([]);
    run(0);
    run(500);
    expect(scrubber.time).toBe(PLAY_DURATION_MS);
    expect(seen.at(-1)).toBe(false);      // a listener reading `playing` in onTime sees the stop
  });

  it('restarts from the beginning when played at the end', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(PLAY_DURATION_MS);
    h.scrubber.play([]);
    expect(h.scrubber.time).toBe(0);
    expect(h.scrubber.playing).toBe(true);
  });

  it('is paused by a seek', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(0);
    h.scrubber.play(segments);
    h.tick(0);
    h.scrubber.seek(700);
    expect(h.scrubber.playing).toBe(false);
    expect(h.cancelled.length).toBeGreaterThan(0);
    h.tick(5000);
    expect(h.scrubber.time).toBe(700);
  });

  it('requests frames as it moves', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(0);
    h.scrubber.play([]);
    h.tick(0);
    h.tick(300);
    expect(h.times.at(-1)).toBe(300);
    expect(h.requests.length).toBeGreaterThan(0);
  });

  it('does nothing before an article is opened', () => {
    const h = harness();
    h.scrubber.play([]);
    expect(h.scrubber.playing).toBe(false);
  });
});

describe('playing over a real range', () => {
  // Found in review: play computed fractional times, the API takes whole milliseconds and
  // rejected every frame between changes.
  const real: TimeRange = { first: Date.UTC(2004, 0, 1), end: Date.UTC(2026, 9, 1, 23, 59, 59) };

  it('moves only to whole milliseconds, at a 60 Hz clock', async () => {
    const h = harness();
    h.scrubber.open(1, real);
    h.scrubber.seek(real.first);
    h.scrubber.play([]);
    for (let clock = 0; clock <= 2000; clock += 1000 / 60) {
      h.tick(clock);
      h.requests.at(-1)?.answer.resolve(frameAt(h.requests.at(-1)?.t ?? 0));
      await settle();
    }
    expect(h.times.length).toBeGreaterThan(50);
    expect(h.times.every(Number.isInteger)).toBe(true);
    expect(h.requests.every((request) => Number.isInteger(request.t))).toBe(true);
  });

  it('rounds a fractional seek too', () => {
    const h = harness();
    h.scrubber.open(1, real);
    h.scrubber.seek(real.first + 1234.56);
    expect(h.scrubber.time).toBe(real.first + 1235);
    expect(h.requests[0]?.t).toBe(real.first + 1235);
  });
});

describe('playing a paragraph with many changes', () => {
  it('shortens the holds so the whole play stays watchable', () => {
    // 60 changes at 1,100 ms each would hold for over a minute; the holds share DWELL_BUDGET_MS instead.
    const many = Array.from({ length: 60 }, (_, i) => seg(200 * (i + 1), 200 * (i + 2)));
    const hold = DWELL_BUDGET_MS / 60;
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(0);
    h.scrubber.play(many);
    h.tick(0);
    h.tick(300);                              // passes the first change at 200: lands on it and holds
    expect(h.scrubber.time).toBe(200);
    h.tick(300 + hold - 1);
    expect(h.scrubber.time).toBe(200);
    h.tick(300 + hold + 50);
    expect(h.scrubber.time).toBeGreaterThan(200);
  });

  it('keeps the full hold when there are few changes', () => {
    expect(3 * DWELL_MS).toBeLessThan(DWELL_BUDGET_MS);     // the three-change test above still holds 1,100 ms
  });
});

describe('dispose', () => {
  it('cancels the animation frame and aborts the request', () => {
    const h = harness();
    h.scrubber.open(1, range);
    h.scrubber.seek(0);
    h.scrubber.play([]);
    h.scrubber.dispose();
    expect(h.scrubber.playing).toBe(false);
    expect(h.requests[0]?.signal.aborted).toBe(true);
    expect(h.cancelled.length).toBeGreaterThan(0);
  });
});
