// A clip of the recorded page, seen through the camera: the page is drawn as a card and the
// shot decides which part of it fills the window.
import React from 'react';
import { OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { cameraAt, viewOf } from '../camera';
import type { Cut, Rect, Shot } from '../camera';
import type { ClipName } from '../footage';
import { CANVAS, COLOR, EASE, PAGE } from '../theme';

interface FootageProps {
  clip: ClipName;
  cut: Cut;
  shots: readonly Shot[];
  /** Where on the canvas the footage shows; the whole canvas when left out. */
  window?: Rect;
  /** Corner radius of the window, in canvas pixels. */
  radius?: number;
}

const WHOLE: Rect = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };

export const Footage: React.FC<FootageProps> = ({ clip, cut, shots, window = WHOLE, radius = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const view = viewOf(cameraAt(shots, frame / fps, EASE), { w: window.w, h: window.h });
  return (
    <div
      style={{
        position: 'absolute', left: window.x, top: window.y, width: window.w, height: window.h, overflow: 'hidden',
        borderRadius: radius, background: COLOR.backdrop,
        boxShadow: radius > 0 ? '0 24px 60px rgba(32, 33, 34, 0.16), 0 0 0 1px rgba(32, 33, 34, 0.10)' : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: PAGE.w, height: PAGE.h, transformOrigin: '0 0',
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, background: COLOR.white, overflow: 'hidden',
          borderRadius: 8, boxShadow: '0 18px 50px rgba(32, 33, 34, 0.18), 0 0 0 1px rgba(32, 33, 34, 0.08)',
        }}
      >
        <OffthreadVideo
          src={staticFile(`footage/${clip}.mp4`)} trimBefore={Math.round(cut.from * fps)} playbackRate={cut.rate} muted
          style={{ width: PAGE.w, height: PAGE.h, display: 'block' }}
        />
      </div>
    </div>
  );
};
