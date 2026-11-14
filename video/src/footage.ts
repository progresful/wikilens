// The recorded takes (record/takes.mjs writes them): where each clip's marked moments are, and
// where the parts of the page were when it was recorded.
import askTake from '../public/footage/ask.json';
import growTake from '../public/footage/grow.json';
import queryTake from '../public/footage/query.json';
import thenTake from '../public/footage/then.json';
import type { Rect } from './camera';

export type ClipName = 'ask' | 'then' | 'grow' | 'query';

interface Take {
  seconds: number;
  marks: Record<string, number>;
  boxes: Record<string, { x: number; y: number; width: number; height: number }>;
}

const TAKES: Record<ClipName, Take> = { ask: askTake, then: thenTake, grow: growTake, query: queryTake };

/** A marked moment of a clip, in seconds from its start. */
export function mark(clip: ClipName, label: string): number {
  const at = TAKES[clip].marks[label];
  if (at === undefined) throw new Error(`the ${clip} take has no mark called ${label}: record it again`);
  return at;
}

/** Where a part of the page was in a clip, in page pixels. */
export function box(clip: ClipName, label: string): Rect {
  const found = TAKES[clip].boxes[label];
  if (found === undefined) throw new Error(`the ${clip} take has no box called ${label}: record it again`);
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

export function clipSeconds(clip: ClipName): number {
  return TAKES[clip].seconds;
}
