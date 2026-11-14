import React from 'react';
import { Composition } from 'remotion';

import { TOTAL_FRAMES } from './plan';
import { Promo } from './Promo';
import { CANVAS, FPS } from './theme';

export const RemotionRoot: React.FC = () => (
  <Composition id="Promo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={CANVAS.w} height={CANVAS.h} />
);
