// One database: while the timeline is dragged, the query behind each frame is shown beside what
// it is running on. The counts are the ones in docs/measurements.md of the project.
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import type { Cut, Rect, Shot } from '../camera';
import { ChapterTag } from '../components/ChapterTag';
import { Footage } from '../components/Footage';
import { SceneFade } from '../components/SceneFade';
import { box, clipSeconds, mark } from '../footage';
import { CLAMP, COLOR, EASE_OUT, FONT, FPS } from '../theme';
import type { Placement } from '../voice';
import { endOf } from '../voice';

const QUERY1: Placement = { id: 'query1', at: 0.1 };
const QUERY2: Placement = { id: 'query2', at: endOf(QUERY1) + 0.2 };
const QUERY3: Placement = { id: 'query3', at: endOf(QUERY2) + 0.2 };
export const QUERY_SECONDS = endOf(QUERY3) + 0.45;
export const QUERY_VOICE: readonly Placement[] = [QUERY1, QUERY2, QUERY3];

const CLIP_FROM = mark('query', 'drag') - 0.4;
/** As it was recorded, or a little slower if the narration needs more than the take holds. */
const CUT: Cut = { from: CLIP_FROM, rate: Math.min(1, (clipSeconds('query') - CLIP_FROM - 0.1) / QUERY_SECONDS) };

const f = (seconds: number): number => Math.round(seconds * FPS);

const STRIP_WINDOW: Rect = { x: 110, y: 150, w: 1700, h: 150 };
const PANEL_WINDOW: Rect = { x: 110, y: 340, w: 700, h: 660 };

/** The timeline track with its year labels, in the shape of the strip. */
function stripShot(): Rect {
  const track = box('query', 'track');
  const h = (track.w + 20) * (STRIP_WINDOW.h / STRIP_WINDOW.w);
  return { x: track.x - 10, y: track.y + (track.h + 20) / 2 - h / 2, w: track.w + 20, h };
}

/** The year and the query panel of the right-hand column, in the shape of the panel window. */
function panelShot(): Rect {
  const year = box('query', 'year');
  const w = year.w + 16;
  return { x: year.x - 8, y: year.y - 8, w, h: w * (PANEL_WINDOW.h / PANEL_WINDOW.w) };
}

const STRIP_SHOTS: readonly Shot[] = [{ at: 0, rect: stripShot() }];
const PANEL_SHOTS: readonly Shot[] = [{ at: 0, rect: panelShot() }];

const COUNTS: readonly { value: number; label: string }[] = [
  { value: 19_742, label: 'articles' },
  { value: 862_076, label: 'revisions, each with its real save time' },
  { value: 1_219_370, label: 'paragraph versions as history rows' },
];

const COLUMN = 880;

export const QueryScene: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const head = interpolate(frame, [5, 20], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const clause = interpolate(frame, [14, 32], [0, 1], { ...CLAMP, easing: EASE_OUT });
  // The counts come in as the rows are spoken of, the last line as vector search is.
  const countsFrom = f(QUERY2.at) + 4;
  const note = interpolate(frame, [f(QUERY3.at) + 30, f(QUERY3.at) + 48], [0, 1], { ...CLAMP, easing: EASE_OUT });
  return (
    <SceneFade frames={frames} edge={6} background={COLOR.backdrop}>
      <Footage clip="query" cut={CUT} shots={STRIP_SHOTS} window={STRIP_WINDOW} radius={14} />
      <Footage clip="query" cut={CUT} shots={PANEL_SHOTS} window={PANEL_WINDOW} radius={14} />

      <div style={{ position: 'absolute', left: COLUMN, top: 346, right: 110 }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 28, fontWeight: 700, letterSpacing: 2.5, color: COLOR.link, opacity: head }}>
          MARIADB 12.3 · EVERY FRAME IS ONE QUERY
        </div>
        <div style={{ marginTop: 22, opacity: clause, transform: `translateY(${(1 - clause) * 16}px)` }}>
          <span style={{ display: 'inline-block', padding: '10px 22px', fontFamily: FONT.mono, fontSize: 52, color: COLOR.ink,
            background: COLOR.white, border: `2px solid ${COLOR.link}`, borderRadius: 8 }}>
            FOR SYSTEM_TIME AS OF
          </span>
        </div>
        <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {COUNTS.map((count, index) => {
            const from = countsFrom + index * 14;
            const shown = interpolate(frame, [from, from + 14], [0, 1], { ...CLAMP, easing: EASE_OUT });
            const counted = interpolate(frame, [from, from + 44], [0, 1], { ...CLAMP, easing: EASE_OUT });
            return (
              <div key={count.label} style={{ display: 'flex', alignItems: 'baseline', gap: 22, opacity: shown,
                transform: `translateY(${(1 - shown) * 14}px)` }}>
                <span style={{ width: 330, textAlign: 'right', fontFamily: FONT.serif, fontSize: 76, lineHeight: 1,
                  color: COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(count.value * counted).toLocaleString('en-GB')}
                </span>
                <span style={{ fontFamily: FONT.sans, fontSize: 30, color: COLOR.subtle }}>{count.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 44, paddingTop: 22, borderTop: `1px solid ${COLOR.hairline}`, fontFamily: FONT.sans, fontSize: 30,
          lineHeight: 1.45, color: COLOR.ink, opacity: note, transform: `translateY(${(1 - note) * 14}px)` }}>
          Each paragraph is a row in a system-versioned table.
          <br />
          The question is ranked by <span style={{ color: COLOR.then, fontWeight: 700 }}>vector search</span> in the same database.
        </div>
      </div>
      <ChapterTag from={0.15} to={3.1} number="05" title="One database" />
    </SceneFade>
  );
};
