// The framings the film uses, in page pixels of the recorded page (1600 x 900). All have the
// canvas's shape, so each fills the frame.
import type { Rect } from './camera';

/** The whole page as a card lying on the backdrop. */
export const WIDE: Rect = { x: -100, y: -56.25, w: 1800, h: 1012.5 };
/** The whole page, edge to edge. */
export const FULL: Rect = { x: 0, y: 0, w: 1600, h: 900 };
/** A slow push into the whole page. */
export const FULL_NEAR: Rect = { x: 32, y: 18, w: 1536, h: 864 };
/** Title, tabs, the question and timeline, and the start of the article. */
export const TOP: Rect = { x: 236, y: 52, w: 1340, h: 753.75 };
/** The timeline band with the answer under it. */
export const ANSWER: Rect = { x: 240, y: 128, w: 1300, h: 731.25 };
/** The timeline and the answer, close enough to read the words change. */
export const SCRUB: Rect = { x: 250, y: 228, w: 1010, h: 568.125 };
/** The answer's own text. */
export const CLOSE: Rect = { x: 255, y: 330, w: 950, h: 534.375 };
/** The "closest to your question" box with today's wording under it. */
export const THEN: Rect = { x: 250, y: 372, w: 950, h: 534.375 };
