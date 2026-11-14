// Every scene comes up from white and goes back to it: the film's only transition.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

import { CLAMP } from '../theme';

interface SceneFadeProps {
  /** The scene's length in frames. */
  frames: number;
  /** Frames spent coming up and going out. */
  edge?: number;
  background?: string;
  children: React.ReactNode;
}

export const SceneFade: React.FC<SceneFadeProps> = ({ frames, edge = 8, background, children }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(
    interpolate(frame, [0, edge], [0, 1], CLAMP),
    interpolate(frame, [frames - edge, frames - 1], [1, 0], CLAMP),
  );
  return <AbsoluteFill style={{ opacity, background }}>{children}</AbsoluteFill>;
};
