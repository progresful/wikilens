// One line under the footage saying what is happening, shown between two moments of the scene.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { CLAMP, COLOR, EASE_OUT, FONT } from '../theme';

interface CaptionProps {
  /** Seconds of the scene between which the line is on screen. */
  from: number;
  to: number;
  /** Where the line sits. At the top when what it speaks of is low in the frame. */
  place?: 'top' | 'bottom';
  children: React.ReactNode;
}

const IN_SECONDS = 0.45;
const OUT_SECONDS = 0.3;

const EDGE = 58;

export const Caption: React.FC<CaptionProps> = ({ from, to, place = 'bottom', children }) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const arrive = interpolate(t, [from, from + IN_SECONDS], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const leave = interpolate(t, [to - OUT_SECONDS, to], [1, 0], CLAMP);
  const opacity = Math.min(arrive, leave);
  if (opacity <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, [place]: EDGE, display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          opacity, transform: `translateY(${(1 - arrive) * (place === 'top' ? -18 : 18)}px)`, padding: '17px 34px 18px', borderRadius: 14,
          background: 'rgba(255, 255, 255, 0.96)', border: `1px solid ${COLOR.hairline}`,
          boxShadow: '0 14px 40px rgba(32, 33, 34, 0.20)', fontFamily: FONT.sans, fontSize: 34, lineHeight: 1.25,
          color: COLOR.ink, whiteSpace: 'nowrap',
        }}
      >
        {children}
      </div>
    </div>
  );
};
