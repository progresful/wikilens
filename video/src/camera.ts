// The film's camera. Footage of the page is a flat picture 1600 x 900 page pixels in size; a
// shot is a rectangle of that picture, and the camera shows it as large as fits the canvas.
// Pure functions.

/** A rectangle, in page pixels (or canvas pixels where said). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** How to draw the page: canvas pixel = page pixel * scale + offset. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** A framing the camera reaches at `at` seconds of the scene, having moved there for `move` seconds. */
export interface Shot {
  at: number;
  rect: Rect;
  move?: number;
}

/** Which part of a clip a scene plays: from this second of it, at this speed. */
export interface Cut {
  from: number;
  rate: number;
}

const DEFAULT_MOVE_SECONDS = 1;

/** Show the whole rectangle, as large as fits, centred on the canvas. */
export function viewOf(rect: Rect, canvas: Size): View {
  const scale = Math.min(canvas.w / rect.w, canvas.h / rect.h);
  return {
    scale,
    x: canvas.w / 2 - (rect.x + rect.w / 2) * scale,
    y: canvas.h / 2 - (rect.y + rect.h / 2) * scale,
  };
}

function between(a: Rect, b: Rect, k: number): Rect {
  const mix = (from: number, to: number): number => from + (to - from) * k;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) };
}

/** Where the camera is at `t` seconds: holding a shot, or easing from it to the next. */
export function cameraAt(shots: readonly Shot[], t: number, ease: (k: number) => number): Rect {
  const first = shots[0];
  if (first === undefined) throw new Error('a scene with no shots has nothing to show');
  let rect = first.rect;
  for (const shot of shots.slice(1)) {
    const move = shot.move ?? DEFAULT_MOVE_SECONDS;
    const begins = shot.at - move;
    if (t <= begins) return rect;
    if (t < shot.at) return between(rect, shot.rect, ease((t - begins) / move));
    rect = shot.rect;
  }
  return rect;
}

/** The smallest rectangle of the given shape (width / height) that holds the boxes with `pad` around them. */
export function around(boxes: readonly Rect[], pad: number, aspect: number): Rect {
  const left = Math.min(...boxes.map((box) => box.x)) - pad;
  const top = Math.min(...boxes.map((box) => box.y)) - pad;
  const right = Math.max(...boxes.map((box) => box.x + box.w)) + pad;
  const bottom = Math.max(...boxes.map((box) => box.y + box.h)) + pad;
  const w = Math.max(right - left, (bottom - top) * aspect);
  const h = w / aspect;
  return { x: (left + right) / 2 - w / 2, y: (top + bottom) / 2 - h / 2, w, h };
}

/** A moment of a clip (seconds from its start) as a moment of the scene that plays it. */
export function sceneTime(clipSeconds: number, cut: Cut): number {
  return (clipSeconds - cut.from) / cut.rate;
}
