import { describe, expect, it } from 'vitest';

import {
  churnLevel,
  clampTime,
  formatDate,
  formatSpan,
  segmentIndexAt,
  snapTime,
  stepChange,
  timeToX,
  xToTime,
} from '../src/time';
import type { Segment, TimeRange } from '../src/types';

const range: TimeRange = { first: Date.UTC(2004, 0, 1), end: Date.UTC(2026, 9, 1, 23, 59, 59) };
const WIDTH = 1000;
const at = (x: number): number => xToTime(x, range, WIDTH);
const seg = (start: number, end: number): Segment => ({
  kind: 'wording', start, end, hash: 'h', text: 't', revId: 1, label: '', tone: 0, loose: false, reverted: false,
});
const segs = [seg(at(100), at(300)), seg(at(300), at(600)), seg(at(600), range.end)];
const DAY = 86_400_000;

describe('positions on the track', () => {
  it('maps the edges of the track to the edges of the range', () => {
    expect(at(0)).toBe(range.first);
    expect(at(WIDTH)).toBe(range.end);
  });

  it('treats a point outside the track as its nearest edge', () => {
    expect(at(-50)).toBe(range.first);
    expect(at(WIDTH + 50)).toBe(range.end);
  });

  it('round-trips a time through a pixel position', () => {
    expect(timeToX(at(250), range, WIDTH)).toBeCloseTo(250, 6);
  });

  it('clamps a time to the range', () => {
    expect(clampTime(range.end + 1, range)).toBe(range.end);
    expect(clampTime(range.first - 1, range)).toBe(range.first);
    expect(clampTime(at(500), range)).toBe(at(500));
  });
});

describe('snapping to a change', () => {
  it('snaps within 8 pixels', () => {
    expect(snapTime(503, [at(500)], range, WIDTH)).toBe(at(500));
    expect(snapTime(492, [at(500)], range, WIDTH)).toBe(at(500));
  });

  it('does not snap beyond 8 pixels', () => {
    expect(snapTime(509, [at(500)], range, WIDTH)).toBe(at(509));
  });

  it('prefers the nearest change, and the earlier one on a tie', () => {
    expect(snapTime(504, [at(500), at(506)], range, WIDTH)).toBe(at(506));
    expect(snapTime(500, [at(500), at(500) + 1], range, WIDTH)).toBe(at(500));
  });

  it('with no changes returns the time under the pointer', () => {
    expect(snapTime(250, [], range, WIDTH)).toBe(at(250));
  });
});

describe('segments', () => {
  it('finds the segment holding a time; a segment begins exactly at its start', () => {
    expect(segmentIndexAt(segs, at(300))).toBe(1);
    expect(segmentIndexAt(segs, at(300) - 1)).toBe(0);
    expect(segmentIndexAt(segs, range.end)).toBe(2);
  });

  it('is -1 before the first segment and for no segments', () => {
    expect(segmentIndexAt(segs, at(99))).toBe(-1);
    expect(segmentIndexAt([], at(99))).toBe(-1);
  });

  it('steps forward to the next change, or stays when there is none', () => {
    expect(stepChange(segs, at(350), 1)).toBe(at(600));
    expect(stepChange(segs, at(700), 1)).toBe(at(700));
  });

  it('steps back to the start of the current wording first, then to earlier changes', () => {
    expect(stepChange(segs, at(350), -1)).toBe(at(300));
    expect(stepChange(segs, at(300), -1)).toBe(at(100));
    expect(stepChange(segs, at(100), -1)).toBe(at(100));
  });
});

describe('formatting', () => {
  it('formats spans the way the server labels them', () => {
    expect(formatSpan(20_000)).toBe('under a minute');
    expect(formatSpan(7 * 60_000)).toBe('7 min');
    expect(formatSpan(5 * 3_600_000)).toBe('5 h');
    expect(formatSpan(12 * DAY)).toBe('12 days');
    expect(formatSpan(1218 * DAY)).toBe('3y 4m');
    expect(formatSpan(1096 * DAY)).toBe('3y');
    expect(formatSpan(90 * DAY)).toBe('3m');
  });

  it('formats dates in UTC', () => {
    expect(formatDate(Date.UTC(2013, 3, 8))).toBe('8 Apr 2013');
    expect(formatDate(Date.UTC(2021, 8, 1, 23, 59))).toBe('1 Sep 2021');
    expect(formatDate(range.end)).toBe('1 Oct 2026');
  });

  it('turns a count of wordings into a tint level from 1 to 5', () => {
    expect([1, 2, 4, 8, 16, 400].map(churnLevel)).toEqual([1, 2, 3, 4, 5, 5]);
    expect(churnLevel(0)).toBe(1);
    expect(churnLevel(3)).toBe(2);
  });
});
