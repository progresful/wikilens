// Timeline arithmetic: positions on the track, snapping, stepping between changes, and
// the wording of dates and durations. Pure functions.
import type { Segment, TimeRange } from './types';

export const SNAP_RADIUS_PX = 8;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function clampTime(t: number, range: TimeRange): number {
  return Math.min(range.end, Math.max(range.first, t));
}

export function timeToX(t: number, range: TimeRange, width: number): number {
  return ((t - range.first) / (range.end - range.first)) * width;
}

export function xToTime(x: number, range: TimeRange, width: number): number {
  const inside = Math.min(width, Math.max(0, x));
  return Math.round(range.first + (inside / width) * (range.end - range.first));
}

/** The time under the pointer, pulled onto a change when one lies within the snap radius. */
export function snapTime(x: number, changes: readonly number[], range: TimeRange, width: number): number {
  let nearest: number | null = null;
  let nearestDistance = Infinity;
  for (const change of changes) {
    const distance = Math.abs(timeToX(change, range, width) - x);
    if (distance <= SNAP_RADIUS_PX && distance < nearestDistance) {
      nearest = change;
      nearestDistance = distance;
    }
  }
  return nearest ?? xToTime(x, range, width);
}

/** Index of the segment in force at `t`; a segment begins exactly at its start. -1 before the first. */
export function segmentIndexAt(segments: readonly Segment[], t: number): number {
  let index = -1;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined || segment.start > t) break;
    index = i;
  }
  return index;
}

/**
 * The next change after `t`, or the previous one before it. Stepping back from inside a
 * wording lands on its start first. With nowhere to go, `t` is returned unchanged.
 */
export function stepChange(segments: readonly Segment[], t: number, dir: 1 | -1): number {
  return stepTo(segments.map((segment) => segment.start), t, dir);
}

/** The nearest start time after `t` (dir 1) or before it (dir -1); `t` itself when there is none. */
export function stepTo(starts: readonly number[], t: number, dir: 1 | -1): number {
  const ordered = [...starts].sort((a, b) => a - b);
  if (dir === 1) {
    return ordered.find((start) => start > t) ?? t;
  }
  return ordered.findLast((start) => start < t) ?? t;
}

export function formatSpan(ms: number): string {
  if (ms < MINUTE) return 'under a minute';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)} h`;
  const days = ms / DAY;
  if (days < 60) return `${Math.round(days)} days`;
  const months = Math.round(days / DAYS_PER_MONTH);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years > 0 ? `${years}y` : '', rest > 0 ? `${rest}mo` : ''].filter(Boolean).join(' ');
}

export function formatDate(t: number): string {
  const date = new Date(t);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Tint level for a paragraph that has had `wordings` distinct wordings: 1 (calm) to 5. */
export function churnLevel(wordings: number): 1 | 2 | 3 | 4 | 5 {
  const level = 1 + Math.floor(Math.log2(Math.max(1, wordings)));
  return Math.min(5, level) as 1 | 2 | 3 | 4 | 5;
}
