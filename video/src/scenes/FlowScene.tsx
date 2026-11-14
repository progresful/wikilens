// One unbroken take of the real page: the question is typed, the paragraph that answers lights
// up, the playhead is dragged back through the years, and the answer is stepped forward one
// change at a time. The parts play at different speeds; the camera carries on across them.
import React from 'react';
import { Sequence } from 'remotion';

import type { Cut, Shot } from '../camera';
import { sceneTime } from '../camera';
import { Caption } from '../components/Caption';
import { ChapterTag } from '../components/ChapterTag';
import { Footage } from '../components/Footage';
import { SceneFade } from '../components/SceneFade';
import { mark } from '../footage';
import { ANSWER, CLOSE, SCRUB, TOP, WIDE } from '../shots';
import { COLOR, FPS } from '../theme';
import type { Placement } from '../voice';
import { endOf, wordStart } from '../voice';

// Typing, faster than it was typed, up to the moment the answer appears.
const TYPING: Cut = { from: mark('ask', 'typing') - 0.45, rate: 1.6 };
const TYPING_S = sceneTime(mark('ask', 'answered'), TYPING);
const ASK1: Placement = { id: 'ask1', at: 0.1 };
// "lights up" is said as the paragraph lights up, or as soon after the first line as it can be.
const ASK2: Placement = { id: 'ask2', at: Math.max(endOf(ASK1) + 0.12, TYPING_S + 0.05 - wordStart('ask2', 'lights')) };

// The answer, held while it is spoken of, until just before the playhead is pressed.
const HOLD: Cut = { from: mark('ask', 'answered'), rate: 1 };
const HOLD_S = Math.min(endOf(ASK2) + 0.25 - TYPING_S, mark('ask', 'drag') - 0.1 - HOLD.from);

// The drag, faster than it was made.
const DRAG_AT = TYPING_S + HOLD_S;
const DRAG: Cut = { from: HOLD.from + HOLD_S, rate: 1.6 };
const DRAG_S = sceneTime(mark('ask', 'dragged') + 0.2, DRAG);
const SCRUB2: Placement = { id: 'scrub2', at: DRAG_AT + 0.05 };

// Three steps forward, as they happened, ending before the fourth.
const STEPS_AT = DRAG_AT + DRAG_S;
const STEPS: Cut = { from: mark('ask', 'steps') - 0.12, rate: 1 };
const SCRUB3: Placement = { id: 'scrub3', at: Math.max(endOf(SCRUB2) + 0.15, STEPS_AT + 0.1) };
const STEPS_S = Math.min(mark('ask', 'step4') - 0.1 - STEPS.from, Math.max(2.8, endOf(SCRUB3) + 0.3 - STEPS_AT));

export const FLOW_SECONDS = STEPS_AT + STEPS_S;
export const FLOW_VOICE: readonly Placement[] = [ASK1, ASK2, SCRUB2, SCRUB3];

const frames = (seconds: number): number => Math.round(seconds * FPS);
const HOLD_FROM = frames(TYPING_S);
const DRAG_FROM = frames(DRAG_AT);
const STEPS_FROM = frames(STEPS_AT);

const TYPING_SHOTS: readonly Shot[] = [{ at: 0, rect: WIDE }, { at: Math.min(1.1, TYPING_S), rect: TOP, move: 0.95 }];
const HOLD_SHOTS: readonly Shot[] = [{ at: 0, rect: TOP }, { at: 1.25, rect: ANSWER, move: 1.05 }];
const DRAG_SHOTS: readonly Shot[] = [{ at: 0, rect: ANSWER }, { at: 1.3, rect: SCRUB, move: 1.15 }];
const STEP_SHOTS: readonly Shot[] = [{ at: 0, rect: SCRUB }, { at: 0.95, rect: CLOSE, move: 0.85 }];

export const FlowScene: React.FC<{ frames: number }> = ({ frames: length }) => (
  <SceneFade frames={length} edge={6} background={COLOR.backdrop}>
    <Sequence durationInFrames={HOLD_FROM}>
      <Footage clip="ask" cut={TYPING} shots={TYPING_SHOTS} />
      <Caption from={0.2} to={TYPING_S}>Ask the article one question.</Caption>
    </Sequence>
    <Sequence from={HOLD_FROM} durationInFrames={DRAG_FROM - HOLD_FROM}>
      <Footage clip="ask" cut={HOLD} shots={HOLD_SHOTS} />
      <Caption from={0.25} to={HOLD_S - 0.05}>The paragraph that answers lights up, right where it sits.</Caption>
    </Sequence>
    <Sequence from={DRAG_FROM} durationInFrames={STEPS_FROM - DRAG_FROM}>
      <Footage clip="ask" cut={DRAG} shots={DRAG_SHOTS} />
      <Caption from={0.25} to={DRAG_S - 0.05}>Drag the timeline. The answer rewrites itself, word by word.</Caption>
    </Sequence>
    <Sequence from={STEPS_FROM}>
      <Footage clip="ask" cut={STEPS} shots={STEP_SHOTS} />
      {/* At the top: the words that change are in the lower half of the frame. */}
      <Caption from={0.25} to={STEPS_S - 0.2} place="top">
        Step through its changes: <span style={{ background: COLOR.added, padding: '0 6px' }}>blue</span> is what arrived.
      </Caption>
    </Sequence>
    <ChapterTag from={0.15} to={TYPING_S + 0.9} number="01" title="Ask once" />
    <ChapterTag from={DRAG_AT + 0.1} to={DRAG_AT + 3.1} number="02" title="Scrub the answer" />
  </SceneFade>
);
