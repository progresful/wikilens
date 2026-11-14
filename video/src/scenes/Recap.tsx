// The story the film has just shown on the real page, said once in type: a sentence of
// Wikipedia and the day its answer changed. The sentence is the film's own translation of the
// Finnish article "Suomen tasavallan presidentti"; the dates are the ones in its history
// (first written 13 July 2008, changed 24 May 2024).
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { SceneFade } from '../components/SceneFade';
import { CLAMP, COLOR, EASE, EASE_OUT, FONT, FPS } from '../theme';
import type { Placement } from '../voice';
import { endOf, wordStart } from '../voice';

const CLOSING: Placement = { id: 'closing', at: 0.3 };
export const RECAP_SECONDS = endOf(CLOSING) + 0.5;
export const RECAP_VOICE: readonly Placement[] = [CLOSING];

const LEFT = 240;
const WIDTH = 1440;
const LEAD = 'The President’s official car is';
const OLD = 'a black armoured Mercedes-Benz S 600 L Guard';
const NEW = 'an Audi A8 L Security Quattro';
const FIRST_YEAR = 2008;
const CHANGE_YEAR = 2024.4;
const LAST_YEAR = 2026.75;

// The change happens as "the answer changed" is said; the second line arrives on its first word.
const CHANGE_FROM = Math.round(CLOSING.at * FPS);
const SAY_MORE_FROM = Math.round((CLOSING.at + wordStart('closing', 'Wikipedia')) * FPS);

function dateLabel(progress: number): string {
  if (progress <= 0) return '13 July 2008';
  if (progress >= 1) return '24 May 2024';
  return String(Math.round(FIRST_YEAR + progress * (CHANGE_YEAR - FIRST_YEAR)));
}

export const Recap: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const tick = interpolate(frame, [CHANGE_FROM, CHANGE_FROM + 24], [0, 1], { ...CLAMP, easing: EASE });
  const strike = interpolate(frame, [CHANGE_FROM + 4, CHANGE_FROM + 18], [0, 1], { ...CLAMP, easing: EASE });
  const arrive = interpolate(frame, [CHANGE_FROM + 14, CHANGE_FROM + 28], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const say = interpolate(frame, [CHANGE_FROM, CHANGE_FROM + 12], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const sayMore = interpolate(frame, [SAY_MORE_FROM, SAY_MORE_FROM + 12], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const year = FIRST_YEAR + tick * (CHANGE_YEAR - FIRST_YEAR);
  const playheadX = ((year - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * WIDTH;

  return (
    <SceneFade frames={frames} edge={7} background={COLOR.white}>
      <div style={{ position: 'absolute', left: LEFT, top: 150, width: WIDTH, display: 'flex', justifyContent: 'space-between',
        fontFamily: FONT.sans, fontSize: 27, color: COLOR.subtle }}>
        <span>Finnish Wikipedia · <span style={{ color: COLOR.link }}>Suomen tasavallan presidentti</span></span>
        <span style={{ color: COLOR.faint }}>translated from Finnish</span>
      </div>
      <div style={{ position: 'absolute', left: LEFT, top: 196, width: WIDTH, paddingBottom: 12, borderBottom: `1px solid ${COLOR.rule}`,
        fontFamily: FONT.serif, fontSize: 84, lineHeight: 1.2, color: COLOR.ink }}>
        {dateLabel(tick)}
      </div>

      <div style={{ position: 'absolute', left: LEFT, top: 356, width: WIDTH, fontFamily: FONT.sans, fontSize: 68, lineHeight: 1.42,
        color: COLOR.ink }}>
        {LEAD}{' '}
        <span style={{ backgroundImage: `linear-gradient(${COLOR.removed}, ${COLOR.removed})`, backgroundRepeat: 'no-repeat',
          backgroundSize: `${strike * 100}% 100%`, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
          textDecoration: strike > 0.5 ? 'line-through' : 'none', textDecorationThickness: 3,
          textDecorationColor: 'rgba(32, 33, 34, 0.6)' }}>
          {OLD}
        </span>
        {/* The sentence ends after the old wording until the new one arrives, then after the new one. */}
        <span style={{ opacity: 1 - strike }}>.</span>{' '}
        <span style={{ opacity: arrive, background: COLOR.added, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
          padding: '0 6px' }}>
          {NEW}
        </span>
        <span style={{ opacity: arrive }}>.</span>
      </div>

      <div style={{ position: 'absolute', left: LEFT, top: 706, width: WIDTH, height: 60 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 2, background: COLOR.hairline }} />
        <div style={{ position: 'absolute', left: 0, top: 14, height: 2, width: playheadX, background: COLOR.ink }} />
        {[2008, 2012, 2016, 2020, 2024].map((label) => (
          <div key={label} style={{ position: 'absolute', left: ((label - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * WIDTH, top: 6 }}>
            <div style={{ width: 2, height: 18, background: COLOR.rule }} />
            <div style={{ marginTop: 8, marginLeft: -22, fontFamily: FONT.sans, fontSize: 22, color: COLOR.subtle }}>{label}</div>
          </div>
        ))}
        <div style={{ position: 'absolute', left: playheadX - 11, top: 4, width: 22, height: 22, borderRadius: 11,
          background: COLOR.ink, border: `3px solid ${COLOR.white}`, boxSizing: 'border-box' }} />
      </div>

      <div style={{ position: 'absolute', left: LEFT, top: 842, width: WIDTH, fontFamily: FONT.serif, fontSize: 60, whiteSpace: 'nowrap',
        color: COLOR.ink }}>
        <span style={{ display: 'inline-block', opacity: say, transform: `translateY(${(1 - say) * 22}px)` }}>The answer changed.</span>
        <span style={{ display: 'inline-block', marginLeft: 26, opacity: sayMore, color: COLOR.link,
          transform: `translateY(${(1 - sayMore) * 22}px)` }}>
          Wikipedia kept every version.
        </span>
      </div>
    </SceneFade>
  );
};
