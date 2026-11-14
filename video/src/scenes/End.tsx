// The close: the name, the line to remember, what it is built on, and the credits it owes.
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { SceneFade } from '../components/SceneFade';
import { TimelineMotif } from '../components/TimelineMotif';
import { CLAMP, COLOR, EASE, EASE_OUT, FONT } from '../theme';
import type { Placement } from '../voice';
import { endOf } from '../voice';

const END: Placement = { id: 'end', at: 0.3 };
export const END_SECONDS = endOf(END) + 1.1;
export const END_VOICE: readonly Placement[] = [END];

const MOTIF_WIDTH = 1120;
const FACTS: readonly { swatch: string; text: string }[] = [
  { swatch: COLOR.link, text: 'MariaDB system-versioned tables' },
  { swatch: COLOR.then, text: 'Vector search in the same database' },
  { swatch: COLOR.heat, text: 'One query per frame, a few milliseconds each' },
];

export const End: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const name = interpolate(frame, [2, 16], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const line = interpolate(frame, [22, 40], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const credits = interpolate(frame, [58, 76], [0, 1], CLAMP);
  const sweep = interpolate(frame, [12, frames - 24], [0.1, 1], { ...CLAMP, easing: EASE });
  return (
    <SceneFade frames={frames} edge={12} background={COLOR.white}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', fontFamily: FONT.serif, fontSize: 170,
        lineHeight: 1, color: COLOR.ink, opacity: name }}>
        WikiLens
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 352, textAlign: 'center', fontFamily: FONT.serif, fontSize: 62,
        color: COLOR.ink, opacity: line, transform: `translateY(${(1 - line) * 18}px)` }}>
        Wikipedia through time, one question at a time.
      </div>
      <div style={{ position: 'absolute', left: (1920 - MOTIF_WIDTH) / 2, top: 508, opacity: line }}>
        <TimelineMotif width={MOTIF_WIDTH} progress={sweep} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 760, display: 'flex', justifyContent: 'center', gap: 54,
        fontFamily: FONT.sans, fontSize: 31, color: COLOR.ink }}>
        {FACTS.map((fact, index) => {
          const shown = interpolate(frame, [40 + index * 7, 54 + index * 7], [0, 1], { ...CLAMP, easing: EASE_OUT });
          return (
            <span key={fact.text} style={{ display: 'inline-flex', alignItems: 'center', gap: 14, opacity: shown,
              transform: `translateY(${(1 - shown) * 14}px)` }}>
              <span style={{ width: 16, height: 16, background: fact.swatch }} />
              {fact.text}
            </span>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 884, textAlign: 'center', fontFamily: FONT.sans, fontSize: 24,
        lineHeight: 1.6, color: COLOR.faint, opacity: credits }}>
        Built for the MariaDB “Wikipedia Through Time” challenge · Junction 2026
        <br />
        Article text: Finnish Wikipedia and its authors, CC BY-SA 4.0 · Not affiliated with Wikipedia or the Wikimedia Foundation
      </div>
    </SceneFade>
  );
};
