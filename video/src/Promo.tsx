// The film: its scenes one after another, and the narration laid over them.
import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, Series, staticFile } from 'remotion';

import { NARRATION, ORDER } from './plan';
import type { SceneId } from './plan';
import { End } from './scenes/End';
import { FlowScene } from './scenes/FlowScene';
import { GrowScene } from './scenes/GrowScene';
import { QueryScene } from './scenes/QueryScene';
import { Recap } from './scenes/Recap';
import { ThenScene } from './scenes/ThenScene';
import { Title } from './scenes/Title';
import { COLOR } from './theme';

const SCENE: Record<SceneId, React.FC<{ frames: number }>> = {
  title: Title, flow: FlowScene, then: ThenScene, grow: GrowScene, query: QueryScene, recap: Recap, end: End,
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.white }}>
    <Series>
      {ORDER.map((each) => {
        const Scene = SCENE[each.id];
        return (
          <Series.Sequence key={each.id} durationInFrames={each.frames}>
            <Scene frames={each.frames} />
          </Series.Sequence>
        );
      })}
    </Series>
    {NARRATION.map((line) => (
      <Sequence key={line.id} from={line.frame} layout="none">
        <Html5Audio src={staticFile(`voice/${line.id}.mp3`)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
