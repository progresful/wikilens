// The film's running order. Each scene says how long it runs and where its narration falls;
// both follow the recorded voice, so nothing here is a fixed number.
import { END_SECONDS, END_VOICE } from './scenes/End';
import { FLOW_SECONDS, FLOW_VOICE } from './scenes/FlowScene';
import { GROW_SECONDS, GROW_VOICE } from './scenes/GrowScene';
import { QUERY_SECONDS, QUERY_VOICE } from './scenes/QueryScene';
import { RECAP_SECONDS, RECAP_VOICE } from './scenes/Recap';
import { THEN_SECONDS, THEN_VOICE } from './scenes/ThenScene';
import { TITLE_SECONDS, TITLE_VOICE } from './scenes/Title';
import { narrationFaults } from './narration';
import { FPS } from './theme';
import type { Placement } from './voice';
import { spoken } from './voice';

export type SceneId = 'title' | 'flow' | 'then' | 'grow' | 'query' | 'recap' | 'end';

interface Scene {
  id: SceneId;
  frames: number;
  voice: readonly Placement[];
}

const scene = (id: SceneId, seconds: number, voice: readonly Placement[]): Scene => ({ id, frames: Math.round(seconds * FPS), voice });

export const ORDER: readonly Scene[] = [
  scene('title', TITLE_SECONDS, TITLE_VOICE),
  scene('flow', FLOW_SECONDS, FLOW_VOICE),
  scene('then', THEN_SECONDS, THEN_VOICE),
  scene('grow', GROW_SECONDS, GROW_VOICE),
  scene('query', QUERY_SECONDS, QUERY_VOICE),
  scene('recap', RECAP_SECONDS, RECAP_VOICE),
  scene('end', END_SECONDS, END_VOICE),
];

export const TOTAL_FRAMES = ORDER.reduce((sum, each) => sum + each.frames, 0);

/** Every line of narration with the frame of the film it starts on. */
export const NARRATION: readonly { id: string; frame: number }[] = ORDER.flatMap((each, index) => {
  const startsAt = ORDER.slice(0, index).reduce((sum, earlier) => sum + earlier.frames, 0);
  return each.voice.map((line) => ({ id: line.id, frame: startsAt + Math.round(line.at * FPS) }));
});

// A new recording of the voice or of a take moves everything: refuse to make a film in which two
// lines are spoken at once or one is cut off by the end.
const faults = narrationFaults(
  NARRATION.map((line) => ({ id: line.id, from: line.frame / FPS, to: line.frame / FPS + spoken(line.id).seconds })),
  TOTAL_FRAMES / FPS,
);
if (faults.length > 0) throw new Error(`the narration does not fit the film: ${faults.join('; ')}`);
