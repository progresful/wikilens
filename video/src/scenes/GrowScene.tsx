// Watch it grow: no question, the timeline played from the article's first line to today,
// as fast as it takes to say so. The contents list and the overview strip fill up as it goes.
import React from 'react';

import type { Cut, Shot } from '../camera';
import { Caption } from '../components/Caption';
import { ChapterTag } from '../components/ChapterTag';
import { Footage } from '../components/Footage';
import { SceneFade } from '../components/SceneFade';
import { mark } from '../footage';
import { FULL_NEAR, WIDE } from '../shots';
import { COLOR } from '../theme';
import type { Placement } from '../voice';
import { endOf } from '../voice';

const GROW: Placement = { id: 'grow', at: 0.1 };
export const GROW_SECONDS = endOf(GROW) + 0.3;
export const GROW_VOICE: readonly Placement[] = [GROW];

const CLIP_FROM = mark('grow', 'play') - 0.3;
/** The whole play, from just before the button is pressed to just after it stops, in the scene's length. */
const CUT: Cut = { from: CLIP_FROM, rate: (mark('grow', 'played') + 0.5 - CLIP_FROM) / GROW_SECONDS };
const SHOTS: readonly Shot[] = [{ at: 0, rect: WIDE }, { at: GROW_SECONDS, rect: FULL_NEAR, move: GROW_SECONDS }];

export const GrowScene: React.FC<{ frames: number }> = ({ frames }) => (
  <SceneFade frames={frames} edge={6} background={COLOR.backdrop}>
    <Footage clip="grow" cut={CUT} shots={SHOTS} />
    <Caption from={0.4} to={GROW_SECONDS - 0.2}>Press play: 23 years of one article, from its first line to today.</Caption>
    <ChapterTag from={0.15} to={3.1} number="04" title="Watch it grow" />
  </SceneFade>
);
