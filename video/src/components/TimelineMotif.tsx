// The site's timeline, drawn for the typographic scenes: a month of edits per bar, the answer's
// wordings as a band under them, and the playhead. The bars are made up; they stand for the idea.
import React from 'react';
import { random } from 'remotion';

import { COLOR, FONT } from '../theme';

interface TimelineMotifProps {
  width: number;
  /** Where the playhead is, 0 to 1. The band is drawn only up to it. */
  progress: number;
  firstYear?: number;
  lastYear?: number;
}

const BARS = 240;
const BAR_AREA = 92;
const BAND_HEIGHT = 16;
// The answer's life: shares of the width, and what each stretch is.
const BAND: readonly { from: number; to: number; kind: 'wording' | 'reverted' | 'then' | 'gap' }[] = [
  { from: 0.08, to: 0.19, kind: 'wording' }, { from: 0.19, to: 0.195, kind: 'reverted' }, { from: 0.195, to: 0.33, kind: 'wording' },
  { from: 0.33, to: 0.47, kind: 'then' }, { from: 0.47, to: 0.52, kind: 'gap' }, { from: 0.52, to: 0.7, kind: 'wording' },
  { from: 0.7, to: 0.706, kind: 'reverted' }, { from: 0.706, to: 0.86, kind: 'wording' }, { from: 0.86, to: 1, kind: 'wording' },
];
const FILL = { wording: COLOR.link, reverted: COLOR.red, then: COLOR.then, gap: 'transparent' } as const;

export const TimelineMotif: React.FC<TimelineMotifProps> = ({ width, progress, firstYear = 2003, lastYear = 2026 }) => {
  const years = Array.from({ length: Math.floor((lastYear - firstYear) / 3) + 1 }, (_, index) => firstYear + index * 3);
  const playheadX = progress * width;
  return (
    <div style={{ position: 'relative', width, height: BAR_AREA + BAND_HEIGHT + 60 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BAR_AREA + BAND_HEIGHT + 14,
        borderTop: `1px solid ${COLOR.hairline}`, borderBottom: `1px solid ${COLOR.hairline}` }} />
      {Array.from({ length: BARS }, (_, index) => {
        const quiet = random(`gap-${index}`) < 0.18;
        const height = quiet ? 3 : 8 + (random(`bar-${index}`) ** 2.2) * (BAR_AREA - 14);
        return (
          <div key={index} style={{ position: 'absolute', left: (index / BARS) * width, top: BAR_AREA - height,
            width: (width / BARS) * 0.72, height, background: COLOR.rule }} />
        );
      })}
      {BAND.map((stretch, index) => {
        const from = stretch.from * width;
        const to = Math.min(stretch.to * width, playheadX);
        if (to <= from) return null;
        return (
          <div key={index} style={{ position: 'absolute', left: from, top: BAR_AREA + 4, width: to - from, height: BAND_HEIGHT,
            background: FILL[stretch.kind], opacity: stretch.kind === 'wording' ? 0.35 + 0.65 * stretch.to : 1,
            boxShadow: `inset -2px 0 0 ${COLOR.white}` }} />
        );
      })}
      <div style={{ position: 'absolute', left: playheadX - 1.5, top: -10, width: 3, height: BAR_AREA + BAND_HEIGHT + 34,
        background: COLOR.ink }} />
      <div style={{ position: 'absolute', left: playheadX - 10, top: -22, width: 20, height: 20, borderRadius: 10,
        background: COLOR.ink, border: `3px solid ${COLOR.white}`, boxSizing: 'border-box' }} />
      {years.map((year) => (
        <div key={year} style={{ position: 'absolute', left: ((year - firstYear) / (lastYear - firstYear + 1)) * width,
          top: BAR_AREA + BAND_HEIGHT + 24, fontFamily: FONT.sans, fontSize: 20, color: COLOR.subtle }}>
          {year}
        </div>
      ))}
    </div>
  );
};
