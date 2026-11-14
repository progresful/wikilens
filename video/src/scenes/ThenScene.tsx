// Then and now: a question about what the article used to say. Today's wording is shown, the
// old one is pointed at with its dates, and one click goes there.
import React from 'react';

import type { Cut, Shot } from '../camera';
import { sceneTime } from '../camera';
import { Caption } from '../components/Caption';
import { ChapterTag } from '../components/ChapterTag';
import { Footage } from '../components/Footage';
import { SceneFade } from '../components/SceneFade';
import { mark } from '../footage';
import { SCRUB, THEN, TOP } from '../shots';
import { COLOR, FPS } from '../theme';
import type { Placement } from '../voice';
import { endOf, wordStart } from '../voice';

const THEN2: Placement = { id: 'then2', at: 0.1 };
// The example question is clicked as the narration asks it.
const CLICK_AT = THEN2.at + wordStart('then2', 'Is') + 0.45;
const CUT: Cut = { from: Math.max(0.1, mark('then', 'asked') - CLICK_AT), rate: 1 };
const at = (label: string): number => sceneTime(mark('then', label), CUT);

const THEN3: Placement = { id: 'then3', at: Math.max(endOf(THEN2) + 0.15, at('answered') + 0.4) };
const THEN4: Placement = { id: 'then4', at: Math.max(endOf(THEN3) + 0.12, at('jumped') - 0.2) };

export const THEN_SECONDS = Math.max(at('jumped') + 2.3, endOf(THEN4) + 0.45);
export const THEN_VOICE: readonly Placement[] = [THEN2, THEN3, THEN4];

const SHOTS: readonly Shot[] = [
  { at: 0, rect: TOP },
  { at: at('answered') + 1.5, rect: THEN, move: 1.1 },
  { at: at('jumped') + 1, rect: SCRUB, move: 0.9 },
];

export const ThenScene: React.FC<{ frames: number }> = ({ frames }) => (
  <SceneFade frames={frames} edge={6} background={COLOR.backdrop}>
    <Footage clip="then" cut={CUT} shots={SHOTS} />
    <Caption from={at('asked') - 0.3} to={at('answered') + 1}>“Is the president’s official car a Mercedes-Benz?”</Caption>
    <Caption from={at('answered') + 1.3} to={at('jumped') - 0.1}>
      Today it says Audi. The closest match is an older wording: <span style={{ color: COLOR.then, fontWeight: 700 }}>Mercedes-Benz</span>.
    </Caption>
    <Caption from={at('jumped') + 0.45} to={frames / FPS - 0.2}>One click, and the article reads as it did in 2017.</Caption>
    <ChapterTag from={0.15} to={3.1} number="03" title="Then and now" />
  </SceneFade>
);
