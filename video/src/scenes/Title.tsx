// The name and what it does in one line, on screen for a second and a half: then the real page.
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { SceneFade } from '../components/SceneFade';
import { TimelineMotif } from '../components/TimelineMotif';
import { CLAMP, COLOR, EASE, EASE_OUT, FONT } from '../theme';
import type { Placement } from '../voice';
import { endOf } from '../voice';

const INTRO: Placement = { id: 'intro', at: 0.08 };
export const TITLE_SECONDS = Math.max(1.5, endOf(INTRO) + 0.05);
export const TITLE_VOICE: readonly Placement[] = [INTRO];

const MOTIF_WIDTH = 1360;

export const Title: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const name = interpolate(frame, [0, 10], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const line = interpolate(frame, [5, 16], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const sweep = interpolate(frame, [0, frames], [0.04, 0.82], { ...CLAMP, easing: EASE });
  return (
    <SceneFade frames={frames} edge={5} background={COLOR.white}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 196, textAlign: 'center', fontFamily: FONT.serif, fontSize: 218,
        lineHeight: 1, color: COLOR.ink, opacity: name, letterSpacing: `${(1 - name) * 10}px` }}>
        WikiLens
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 452, textAlign: 'center', fontFamily: FONT.sans, fontSize: 50,
        color: COLOR.subtle, opacity: line, transform: `translateY(${(1 - line) * 14}px)` }}>
        Ask an article once. <span style={{ color: COLOR.ink }}>Scrub the answer through time.</span>
      </div>
      <div style={{ position: 'absolute', left: (1920 - MOTIF_WIDTH) / 2, top: 660, opacity: line }}>
        <TimelineMotif width={MOTIF_WIDTH} progress={sweep} />
      </div>
    </SceneFade>
  );
};
