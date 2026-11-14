// Arithmetic for the overview strip beside the article: one bar per block, stacked at an even
// pitch, with a box over the bars of the blocks that are in view. Pure functions.

export const MAX_PITCH_PX = 5;          // a short article keeps roomy bars, so its growth over the years shows
export const FULL_WIDTH_CHARS = 600;    // a text this long, or longer, gets a bar of the full width

const MIN_WIDTH_PERCENT = 25;
const MIN_BAR_SHARE = 0.6;              // of the pitch, once there is no room left for a 1px gap

/** How far apart bars sit, and how thick one is, in pixels. */
export interface Pitch {
  pitch: number;
  bar: number;
}

/** A block's place in the scrolling article, in pixels. */
export interface Box {
  top: number;
  height: number;
}

/** A range of blocks, as fractional indexes: 1.5 is halfway down the second block. */
export interface Span {
  from: number;
  to: number;
}

/** A point of the overview: the block under it and how far down that block (0 to 1). */
export interface Spot {
  index: number;
  within: number;
}

/** The pitch at which `count` bars fit into `height` pixels. Roomy until the height is known. */
export function minimapPitch(count: number, height: number): Pitch {
  const pitch = count === 0 || height <= 0 ? MAX_PITCH_PX : Math.min(MAX_PITCH_PX, height / count);
  return { pitch, bar: Math.max(pitch - 1, pitch * MIN_BAR_SHARE) };
}

/** A bar's width for a text of `chars` characters; a text that is not loaded yet gets a middling bar. */
export function barWidthPercent(chars: number | undefined): number {
  const share = Math.min(1, (chars ?? FULL_WIDTH_CHARS / 2) / FULL_WIDTH_CHARS);
  return MIN_WIDTH_PERCENT + share * (100 - MIN_WIDTH_PERCENT);
}

/** The fractional block index at a pixel of the article; space above a block counts as its start. */
function indexAt(boxes: readonly Box[], y: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box === undefined || box.height <= 0) continue;
    if (y < box.top) return i;
    if (y < box.top + box.height) return i + (y - box.top) / box.height;
  }
  return boxes.length;
}

/** The blocks between the top and bottom edges of the view; null for an article with no blocks. */
export function visibleSpan(boxes: readonly Box[], scrollTop: number, viewHeight: number): Span | null {
  if (boxes.length === 0) return null;
  return { from: indexAt(boxes, scrollTop), to: indexAt(boxes, scrollTop + viewHeight) };
}

/** The block drawn at `y` pixels down the overview; outside the bars, the first or the last one. */
export function blockAt(y: number, pitch: number, count: number): Spot | null {
  if (count === 0 || pitch <= 0) return null;
  const position = Math.min(count, Math.max(0, y / pitch));
  const index = Math.min(count - 1, Math.floor(position));
  return { index, within: position - index };
}
