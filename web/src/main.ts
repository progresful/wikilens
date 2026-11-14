// Wiring: the API, the scrub controller, the state, and the views.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/newsreader';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

import { ApiError, createApi } from './api';
import { cleanQuestion } from './question';
import { createScrubber } from './scrub';
import { initialState, reduce } from './state';
import type { Action, AppState } from './state';
import { formatDate, formatSpan, segmentIndexAt, snapTime, stepTo } from './time';
import type { Frame, Overview } from './types';
import { mountAbout } from './views/about';
import { mountAnswer } from './views/answer';
import { mountAsk } from './views/ask';
import { mountMinimap } from './views/minimap';
import { mountPage } from './views/page';
import { mountPicker } from './views/picker';
import { mountSqlPanel } from './views/sqlPanel';
import { mountTimeline } from './views/timeline';
import { createWordingCache } from './wordingCache';

const WIKIPEDIA = 'https://fi.wikipedia.org/';
const DEFAULT_TITLE = 'Talvisota';
const NO_EXAMPLES: readonly { fi: string; en: string }[] = [];

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`the page is missing ${selector}`);
  return element;
}

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'something went wrong';
}

const api = createApi();
const cache = createWordingCache();
const requestedHashes = new Set<string>();
let state: AppState = initialState;

const nowDate = must<HTMLElement>('.now-date');
const nowRel = must<HTMLElement>('.now-rel');
const pageScroll = must<HTMLElement>('#page-scroll');
const reviewStatus = must<HTMLElement>('.review-status');
const bigYear = must<HTMLElement>('.big-year');
const errorLine = must<HTMLElement>('.error-line');
const playButton = must<HTMLButtonElement>('.play');
const credit = must<HTMLElement>('.credit');
const legend = must<HTMLElement>('#legend');

const pageView = mountPage(must('#page'));
const answerView = mountAnswer(pageView, must('#page-scroll'), {
  onJump: (t) => {
    scrubber.seek(t);
    syncPlaying();
  },
});
const askView = mountAsk(must('#ask'), {
  onAsk: (question) => void ask(question),
  onChip: (paraId) => void track(paraId),
  onClear: () => dispatch({ type: 'question-cleared' }),
});
const minimapView = mountMinimap(must('#minimap'));
const sqlView = mountSqlPanel(must('#sql'));
const pickerView = mountPicker(must('#picker'), { onArticle: (pageId) => void openArticle(pageId) });
const timelineView = mountTimeline(must('#timeline'), {
  onSeek: (x, width) => {
    if (state.range === null) return;
    scrubber.seek(snapTime(x, changeTimes(), state.range, width));
    syncPlaying();
  },
});

mountAbout(must('#about'), must<HTMLButtonElement>('.about-toggle'), { loadCoverage: () => api.coverage() });

const scrubber = createScrubber({
  fetchFrame: (pageId, t, signal) => api.frame(pageId, t, signal),
  onTime: (t) => {
    dispatch({ type: 'time', t });
    syncPlaying();
  },
  onFrame: (frame) => {
    if (state.error !== null) dispatch({ type: 'error', message: null });   // the server answered: any earlier failure is over
    dispatch({ type: 'frame', frame });
    void loadWordings(frame);
  },
  onError: (error) => dispatch({ type: 'error', message: error === null ? null : message(error) }),
});

function dispatch(action: Action): void {
  state = reduce(state, action);
  render();
}

function syncPlaying(): void {
  if (state.playing !== scrubber.playing) dispatch({ type: 'playing', playing: scrubber.playing });
}

/** The moments the arrow keys and the snap use: the answer's changes, or else months with edits. */
function changeTimes(): number[] {
  if (state.tracked !== null) return state.tracked.segments.map((segment) => segment.start);
  return [];
}

function stepTimes(): number[] {
  if (state.tracked !== null) return changeTimes();
  return (state.overview?.bars ?? []).map((bar) => {
    const [year, month] = bar.month.split('-').map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, 1);
  });
}

async function loadWordings(frame: Frame): Promise<void> {
  const wanted = cache.missing(frame.blocks.map((block) => block.hash)).filter((hash) => !requestedHashes.has(hash));
  if (wanted.length === 0) return;
  for (const hash of wanted) requestedHashes.add(hash);
  try {
    cache.put(await api.wordings(wanted));
    dispatch({ type: 'wordings' });
  } catch (error: unknown) {
    for (const hash of wanted) requestedHashes.delete(hash);
    dispatch({ type: 'error', message: message(error) });
  }
}

/** Every wording of the article, fetched once, so no later frame has to wait for a text. */
async function loadAllWordings(pageId: number): Promise<void> {
  try {
    cache.put(await api.articleWordings(pageId));
    if (state.pageId === pageId) dispatch({ type: 'wordings' });
  } catch {
    // Not fatal: each frame still asks for the texts it is missing.
  }
}

function rangeFor(overview: Overview): { first: number; end: number } {
  // From 1 January of the first revision's year, so there is a short lead-in before the article exists.
  return { first: Date.UTC(new Date(overview.firstTs).getUTCFullYear(), 0, 1), end: overview.corpusEnd };
}

let lastOpening = 0;

async function openArticle(pageId: number): Promise<void> {
  const opening = ++lastOpening;
  try {
    const overview = await api.overview(pageId);
    if (opening !== lastOpening) return;       // a later choice of article has overtaken this one
    const range = rangeFor(overview);
    scrubber.open(pageId, range);
    dispatch({ type: 'article-opened', pageId, overview, range });
    history.replaceState(null, '', `?article=${pageId}`);
    scrubber.seek(range.end);
    void loadAllWordings(pageId);
  } catch (error: unknown) {
    dispatch({ type: 'error', message: message(error) });
  }
}

let lastAsking = 0;

async function ask(raw: string): Promise<void> {
  const question = cleanQuestion(raw);
  if (question === null) {
    dispatch({ type: 'ask-failed', message: 'Type a question about this article first (up to 300 characters).' });
    return;
  }
  const pageId = state.pageId;
  if (pageId === null) return;
  const asking = ++lastAsking;
  dispatch({ type: 'asking' });
  try {
    const result = await api.ask(pageId, question);
    // The answer belongs to the article and the question it was asked of. If either has changed
    // meanwhile (a cold model can take seconds), it is dropped.
    if (state.pageId !== pageId || asking !== lastAsking) return;
    dispatch({ type: 'asked', question, result });
    timelineView.track.focus();      // arrows and space now drive the playhead
  } catch (error: unknown) {
    if (state.pageId !== pageId || asking !== lastAsking) return;
    dispatch({ type: 'ask-failed', message: message(error) });
  }
}

async function track(paraId: number): Promise<void> {
  const pageId = state.pageId;
  if (pageId === null) return;
  try {
    const segments = await api.paragraphTimeline(pageId, paraId);
    if (state.pageId !== pageId) return;
    dispatch({ type: 'tracked', paraId, segments });
    timelineView.track.focus();
  } catch (error: unknown) {
    if (state.pageId !== pageId) return;
    dispatch({ type: 'error', message: message(error) });
  }
}

function togglePlay(): void {
  if (scrubber.playing) scrubber.pause();
  else scrubber.play(state.tracked?.segments ?? []);
  syncPlaying();
}

function step(dir: 1 | -1): void {
  if (state.range === null) return;
  scrubber.seek(stepTo(stepTimes(), state.time, dir));
  syncPlaying();
}

/** Whether this article's story was read by a person. Always on screen, not only inside the list. */
function renderReviewStatus(): void {
  const article = state.articles.find((candidate) => candidate.pageId === state.pageId);
  if (article === undefined) {
    reviewStatus.textContent = '';
    return;
  }
  reviewStatus.classList.toggle('reviewed', article.reviewed);
  reviewStatus.textContent = article.reviewed ? 'story read by hand'
    : article.tier === 1 ? 'automatic matching, not reviewed'
      : 'history only · automatic matching, not reviewed';
}

function renderCredit(): void {
  if (state.pageId === null || credit.dataset.pageId === String(state.pageId)) return;
  credit.dataset.pageId = String(state.pageId);
  const link = document.createElement('a');
  link.href = `${WIKIPEDIA}?curid=${state.pageId}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'the article and its authors';
  credit.title = 'Simplified: templates, tables and references are not shown.';
  credit.replaceChildren('Text: Finnish Wikipedia, CC BY-SA 4.0, simplified · ', link);
}

const LEGEND_LANDING: readonly (readonly [string, string])[] = [
  ['#333b45', 'every edit, by month'],
  ['linear-gradient(90deg, rgba(240,168,58,.12), rgba(229,120,50,.6))', 'paragraph tint: how often it has been reworded'],
];
const LEGEND_ASKED: readonly (readonly [string, string])[] = [
  ['#333b45', 'every edit, by month'],
  ['linear-gradient(90deg, rgba(239,231,214,.25), #efe7d6)', 'one wording of the answer, brighter = later'],
  ['#e5533b', 'replaced, then reverted'],
  ['repeating-linear-gradient(135deg, transparent 0 3px, #5b6470 3px 4px)', 'answer missing'],
];

function renderLegend(): void {
  const mode = state.tracked === null ? 'landing' : 'asked';
  if (legend.dataset.mode === mode) return;
  legend.dataset.mode = mode;
  legend.replaceChildren(...(mode === 'landing' ? LEGEND_LANDING : LEGEND_ASKED).map(([background, label]) => {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = background;
    item.append(swatch, label);
    return item;
  }));
}

/** The line under the date: what the tracked wording did, or what the article's history holds. */
function nowLine(): string {
  const tracked = state.tracked;
  if (tracked === null) return landingLine();
  const segment = tracked.segments[segmentIndexAt(tracked.segments, state.time)];
  if (segment === undefined) return 'before this paragraph was written';
  const lasted = formatSpan(segment.end - segment.start);
  if (segment.kind === 'gap') return `no such paragraph in the article for ${lasted}`;
  return segment.reverted ? `this wording survived ${lasted}` : `this wording stood for ${lasted}`;
}

function landingLine(): string {
  const article = state.articles.find((candidate) => candidate.pageId === state.pageId);
  if (article === undefined || state.overview === null) return '';
  return `${article.revisions.toLocaleString('en-GB')} revisions since ${formatDate(state.overview.firstTs)}`;
}

function render(): void {
  const overview = state.overview;
  nowDate.textContent = state.range === null ? '' : formatDate(state.time);
  bigYear.textContent = state.range === null ? '' : String(new Date(state.time).getUTCFullYear());
  nowRel.textContent = nowLine();
  // While frames fail, the page still shows an earlier moment than the playhead: say so and dim it.
  const stale = state.error !== null && state.frame !== null && state.frame.t !== state.time;
  pageScroll.classList.toggle('stale', stale);
  errorLine.hidden = state.error === null;
  errorLine.textContent = state.error === null ? ''
    : stale && state.frame !== null ? `${state.error} · the page shows ${formatDate(state.frame.t)}` : state.error;
  renderReviewStatus();
  playButton.textContent = state.playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-pressed', String(state.playing));
  playButton.setAttribute('aria-label', state.playing ? 'pause' : 'play');
  pickerView.update({ articles: state.articles, pageId: state.pageId });
  timelineView.update({
    range: state.range, bars: overview?.bars ?? null, segments: state.tracked?.segments ?? [], time: state.time,
  });
  // Right after a question, the panel shows the ranking that answered it; the next frame takes over.
  const showRanking = state.ask !== null && state.askedAtFrame === state.frameCount;
  sqlView.update(showRanking && state.ask !== null
    ? { sql: state.ask.sql, dbMs: state.ask.rankMs, count: state.frameCount, note: 'the question' }
    : { sql: state.frame?.sql ?? null, dbMs: state.frame?.dbMs ?? null, count: state.frameCount, note: null });
  const article = state.articles.find((candidate) => candidate.pageId === state.pageId);
  askView.update({
    question: state.question, asking: state.asking, message: state.askMessage, ask: state.ask,
    trackedParaId: state.tracked?.paraId ?? null, examples: article?.questions ?? NO_EXAMPLES,
  });
  if (overview !== null) {
    const churn = state.tracked === null ? overview.churn : null;
    const answerParaId = state.tracked?.paraId ?? null;
    pageView.update({
      pageId: overview.pageId, title: overview.title, firstTs: overview.firstTs, frame: state.frame, cache,
      wordingsVersion: state.wordingsVersion, churn, answerParaId,
    });
    minimapView.update({ frame: state.frame, cache, wordingsVersion: state.wordingsVersion, churn, answerParaId });
    const weak = state.ask?.matches.find((match) => match.paraId === answerParaId)?.weak ?? false;
    answerView.update({ tracked: state.tracked, time: state.time, corpusEnd: overview.corpusEnd, weak });
  }
  renderCredit();
  renderLegend();
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

window.addEventListener('keydown', (event) => {
  if (isTyping(event.target)) return;
  if (event.key === ' ') {
    event.preventDefault();
    togglePlay();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    step(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    step(1);
  }
});
playButton.addEventListener('click', togglePlay);
must<HTMLButtonElement>('.prev').addEventListener('click', () => step(-1));
must<HTMLButtonElement>('.next').addEventListener('click', () => step(1));

async function start(): Promise<void> {
  try {
    const articles = await api.articles();
    dispatch({ type: 'articles', articles });
    const asked = Number(new URLSearchParams(location.search).get('article'));
    const chosen = articles.find((article) => article.pageId === asked)
      ?? articles.find((article) => article.reviewed)
      ?? articles.find((article) => article.title === DEFAULT_TITLE)
      ?? articles[0];
    if (chosen === undefined) {
      dispatch({ type: 'error', message: 'no articles are loaded yet: run python -m wikilens.ingest --tier1' });
      return;
    }
    await openArticle(chosen.pageId);
  } catch (error: unknown) {
    dispatch({ type: 'error', message: message(error) });
  }
}

render();
void start();
