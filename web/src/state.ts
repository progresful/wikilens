// The page's state and the one function that changes it. reduce() returns a new object each
// time and never alters the one it is given.
import type { Article, AskResult, Frame, Overview, Segment, TimeRange } from './types';

export interface Tracked {
  readonly paraId: number;
  readonly segments: readonly Segment[];
}

export interface AppState {
  readonly articles: readonly Article[];
  readonly pageId: number | null;
  readonly overview: Overview | null;
  readonly range: TimeRange | null;
  readonly time: number;
  readonly frame: Frame | null;
  readonly frameCount: number;
  readonly wordingsVersion: number;   // goes up when paragraph texts arrive, so the page redraws
  readonly error: string | null;
  readonly playing: boolean;
  readonly question: string;
  readonly asking: boolean;
  readonly ask: AskResult | null;
  readonly askMessage: string | null;
  readonly tracked: Tracked | null;   // the paragraph whose life is on the timeline
  readonly askedAtFrame: number | null;   // frames seen when the question was answered: until the next one, the SQL panel shows the ranking
}

export type Action =
  | { type: 'articles'; articles: readonly Article[] }
  | { type: 'article-opened'; pageId: number; overview: Overview; range: TimeRange }
  | { type: 'time'; t: number }
  | { type: 'frame'; frame: Frame }
  | { type: 'wordings' }
  | { type: 'error'; message: string | null }
  | { type: 'playing'; playing: boolean }
  | { type: 'asking' }
  | { type: 'asked'; question: string; result: AskResult }
  | { type: 'ask-failed'; message: string }
  | { type: 'tracked'; paraId: number; segments: readonly Segment[] }
  | { type: 'question-cleared' };

export const NOTHING_MATCHES = 'Nothing in this article matches that question.';

const NO_QUESTION = { question: '', asking: false, ask: null, askMessage: null, tracked: null, askedAtFrame: null } as const;

export const initialState: AppState = {
  articles: [],
  pageId: null,
  overview: null,
  range: null,
  time: 0,
  frame: null,
  frameCount: 0,
  wordingsVersion: 0,
  error: null,
  playing: false,
  ...NO_QUESTION,
};

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'articles':
      return { ...state, articles: action.articles };
    case 'article-opened':
      return {
        ...state, ...NO_QUESTION, pageId: action.pageId, overview: action.overview, range: action.range,
        time: action.range.end, frame: null, frameCount: 0, error: null, playing: false,
      };
    case 'time':
      return { ...state, time: action.t };
    case 'frame':
      return { ...state, frame: action.frame, frameCount: state.frameCount + 1 };
    case 'wordings':
      return { ...state, wordingsVersion: state.wordingsVersion + 1 };
    case 'error':
      return { ...state, error: action.message };
    case 'playing':
      return { ...state, playing: action.playing };
    case 'asking':
      return { ...state, asking: true, askMessage: null };
    case 'asked': {
      const best = action.result.matches[0];
      return {
        ...state, question: action.question, asking: false, ask: action.result, askedAtFrame: state.frameCount,
        askMessage: best === undefined ? NOTHING_MATCHES : null,
        tracked: best === undefined ? null : { paraId: best.paraId, segments: action.result.timeline },
      };
    }
    case 'ask-failed':
      return { ...state, asking: false, askMessage: action.message };
    case 'tracked':
      return { ...state, tracked: { paraId: action.paraId, segments: action.segments } };
    case 'question-cleared':
      return { ...state, ...NO_QUESTION };
  }
}
