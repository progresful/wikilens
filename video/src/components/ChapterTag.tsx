// The name of a chapter, shown small in a corner while the real page stays on screen.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { CLAMP, COLOR, EASE_OUT, FONT } from '../theme';

interface ChapterTagProps {
  /** Seconds of the scene between which the tag is on screen. */
  from: number;
  to: number;
  number: string;
  title: string;
}

export const ChapterTag: React.FC<ChapterTagProps> = ({ from, to, number, title }) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const arrive = interpolate(t, [from, from + 0.4], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const leave = interpolate(t, [to - 0.3, to], [1, 0], CLAMP);
  const opacity = Math.min(arrive, leave);
  if (opacity <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 56, top: 48, opacity, transform: `translateX(${(1 - arrive) * -24}px)`,
      display: 'flex', alignItems: 'center', gap: 18, padding: '14px 26px 15px 22px', borderRadius: 12, background: COLOR.ink,
      boxShadow: '0 14px 40px rgba(32, 33, 34, 0.28)', fontFamily: FONT.sans, fontSize: 32, color: COLOR.white }}>
      <span style={{ fontWeight: 700, letterSpacing: 2, color: COLOR.added }}>{number}</span>
      <span style={{ fontFamily: FONT.serif, fontSize: 38 }}>{title}</span>
    </div>
  );
};
