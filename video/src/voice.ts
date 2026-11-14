// The narration (record/voice.mjs makes it): how long each line is and when its words begin.
// The film is cut to these, so the picture changes on the word that speaks of it.
import manifest from '../public/voice/voice.json';

interface Line {
  text: string;
  seconds: number;
  words: { word: string; start: number }[];
}

/** A line of narration and when it starts, in seconds from the start of its scene. */
export interface Placement {
  id: string;
  at: number;
}

const LINES: Record<string, Line> = manifest.lines;

export function spoken(id: string): Line {
  const line = LINES[id];
  if (line === undefined) throw new Error(`there is no narration line called ${id}: run record/voice.mjs`);
  return line;
}

/** When, within a line, the first word beginning with `begins` starts. */
export function wordStart(id: string, begins: string): number {
  const found = spoken(id).words.find((word) => word.word.toLowerCase().startsWith(begins.toLowerCase()));
  if (found === undefined) throw new Error(`the narration line ${id} has no word beginning "${begins}"`);
  return found.start;
}

/** When a line placed at `at` has been said. */
export function endOf(placement: Placement): number {
  return placement.at + spoken(placement.id).seconds;
}
