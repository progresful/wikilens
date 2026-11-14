import { describe, expect, it } from 'vitest';

import { initialState, reduce } from '../src/state';
import type { AskResult, Frame, Overview, Segment } from '../src/types';

const overview: Overview = {
  pageId: 1, title: 'Testisota', firstTs: 10, lastTs: 20, corpusEnd: 100, bars: [], churn: { '2': 4 }, hasVectors: true,
};
const frame: Frame = { t: 50, blocks: [], sql: 'SELECT', dbMs: 1 };
const segment: Segment = {
  kind: 'wording', start: 10, end: 100, hash: 'h', text: 't', revId: 1, label: 'first appears', tone: 0,
  loose: false, reverted: false,
};
const askResult: AskResult = {
  mode: 'vector',
  matches: [
    { paraId: 2, distance: 0.2, weak: false, preview: 'a', closestHash: 'h' },
    { paraId: 3, distance: 0.9, weak: true, preview: 'b', closestHash: null },
  ],
  timeline: [segment], embedMs: 1, rankMs: 2, sql: 'SELECT',
};
const opened = reduce(initialState, { type: 'article-opened', pageId: 1, overview, range: { first: 0, end: 100 } });

describe('reduce', () => {
  it('never alters the state it is given', () => {
    const before = JSON.stringify(initialState);
    reduce(initialState, { type: 'time', t: 5 });
    expect(JSON.stringify(initialState)).toBe(before);
  });

  it('opens an article at the end of its range with nothing asked', () => {
    expect(opened.pageId).toBe(1);
    expect(opened.time).toBe(100);
    expect(opened.frame).toBeNull();
    expect(opened.tracked).toBeNull();
  });

  it('opening another article forgets the previous question and frame', () => {
    const asked = reduce(reduce(opened, { type: 'frame', frame }), { type: 'asked', question: 'q', result: askResult });
    const reopened = reduce(asked, { type: 'article-opened', pageId: 2, overview, range: { first: 0, end: 100 } });
    expect(reopened.tracked).toBeNull();
    expect(reopened.ask).toBeNull();
    expect(reopened.frame).toBeNull();
    expect(reopened.frameCount).toBe(0);
  });

  it('counts frames', () => {
    const twice = reduce(reduce(opened, { type: 'frame', frame }), { type: 'frame', frame });
    expect(twice.frameCount).toBe(2);
    expect(twice.frame).toBe(frame);
  });

  it('tracks the best match after a question', () => {
    const asked = reduce(opened, { type: 'asked', question: 'Miksi?', result: askResult });
    expect(asked.tracked).toEqual({ paraId: 2, segments: [segment], closestHash: 'h' });     // with the wording that matched best
    expect(asked.question).toBe('Miksi?');
    expect(asked.asking).toBe(false);
    expect(asked.askMessage).toBeNull();
  });

  it('says so when nothing matches', () => {
    const asked = reduce(opened, { type: 'asked', question: 'q', result: { ...askResult, matches: [], timeline: [] } });
    expect(asked.tracked).toBeNull();
    expect(asked.askMessage).toContain('Nothing');
  });

  it('switches the tracked paragraph', () => {
    const asked = reduce(opened, { type: 'asked', question: 'q', result: askResult });
    const switched = reduce(asked, { type: 'tracked', paraId: 3, segments: [], closestHash: 'x' });
    expect(switched.tracked).toEqual({ paraId: 3, segments: [], closestHash: 'x' });
    expect(switched.ask).toBe(askResult);
  });

  it('keeps the message of a failed question and stops waiting', () => {
    const failed = reduce(reduce(opened, { type: 'asking' }), { type: 'ask-failed', message: 'embedding service unavailable' });
    expect(failed.asking).toBe(false);
    expect(failed.askMessage).toBe('embedding service unavailable');
  });

  it('records time, errors, playing and newly arrived texts', () => {
    expect(reduce(opened, { type: 'time', t: 42 }).time).toBe(42);
    expect(reduce(opened, { type: 'error', message: 'database unavailable' }).error).toBe('database unavailable');
    expect(reduce(opened, { type: 'playing', playing: true }).playing).toBe(true);
    expect(reduce(opened, { type: 'wordings' }).wordingsVersion).toBe(opened.wordingsVersion + 1);
    expect(reduce(initialState, { type: 'articles', articles: [] }).articles).toEqual([]);
  });

  it('clears the question', () => {
    const asked = reduce(opened, { type: 'asked', question: 'q', result: askResult });
    const cleared = reduce(asked, { type: 'question-cleared' });
    expect(cleared.tracked).toBeNull();
    expect(cleared.ask).toBeNull();
    expect(cleared.question).toBe('');
  });
});
