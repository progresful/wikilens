// Wiring: the API, the scrub controller, the state, and the views.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/newsreader';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

import { ApiError, createApi } from './api';
import { createScrubber } from './scrub';
import { initialState, reduce } from './state';
import type { Action, AppState } from './state';
import { formatDate, snapTime, stepTo } from './time';
import type { Frame, Overview } from './types';
import { mountMinimap } from './views/minimap';
import { mountPage } from './views/page';
import { mountPicker } from './views/picker';
import { mountSqlPanel } from './views/sqlPanel';
import { mountTimeline } from './views/timeline';
import { createWordingCache } from './wordingCache';

const WIKIPEDIA = 'https://fi.wikipedia.org/';
const DEFAULT_TITLE = 'Talvisota';

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
const bigYear = must<HTMLElement>('.big-year');
const errorLine = must<HTMLElement>('.error-line');
const playButton = must<HTMLButtonElement>('.play');
const credit = must<HTMLElement>('.credit');
const legend = must<HTMLElement>('#legend');

const pageView = mountPage(must('#page'));
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

const scrubber = createScrubber({
  fetchFrame: (pageId, t, signal) => api.frame(pageId, t, signal),
  onTime: (t) => {
    dispatch({ type: 'time', t });
    syncPlaying();
  },
  onFrame: (frame) => {
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

function rangeFor(overview: Overview): { first: number; end: number } {
  // From 1 January of the first revision's year, so there is a short lead-in before the article exists.
  return { first: Date.UTC(new Date(overview.firstTs).getUTCFullYear(), 0, 1), end: overview.corpusEnd };
}

async function openArticle(pageId: number): Promise<void> {
  try {
    const overview = await api.overview(pageId);
    const range = rangeFor(overview);
    scrubber.open(pageId, range);
    dispatch({ type: 'article-opened', pageId, overview, range });
    history.replaceState(null, '', `?article=${pageId}`);
    scrubber.seek(range.end);
  } catch (error: unknown) {
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

function renderCredit(): void {
  if (state.pageId === null || credit.dataset.pageId === String(state.pageId)) return;
  credit.dataset.pageId = String(state.pageId);
  const link = document.createElement('a');
  link.href = `${WIKIPEDIA}?curid=${state.pageId}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'the article and its authors';
  credit.replaceChildren(
    'Text: Finnish Wikipedia, CC BY-SA 4.0, simplified (no templates, tables or references) · ',
    link,
  );
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

/** The line under the date while no question is asked: what the article's history holds. */
function landingLine(): string {
  const article = state.articles.find((candidate) => candidate.pageId === state.pageId);
  if (article === undefined || state.overview === null) return '';
  return `${article.revisions.toLocaleString('en-GB')} revisions since ${formatDate(state.overview.firstTs)}`;
}

function render(): void {
  const overview = state.overview;
  nowDate.textContent = state.range === null ? '' : formatDate(state.time);
  bigYear.textContent = state.range === null ? '' : String(new Date(state.time).getUTCFullYear());
  nowRel.textContent = landingLine();
  errorLine.hidden = state.error === null;
  errorLine.textContent = state.error ?? '';
  playButton.textContent = state.playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-pressed', String(state.playing));
  playButton.setAttribute('aria-label', state.playing ? 'pause' : 'play');
  pickerView.update({ articles: state.articles, pageId: state.pageId });
  timelineView.update({
    range: state.range, bars: overview?.bars ?? null, segments: state.tracked?.segments ?? [], time: state.time,
  });
  sqlView.update({
    sql: state.frame?.sql ?? null, dbMs: state.frame?.dbMs ?? null, count: state.frameCount, note: null,
  });
  if (overview !== null) {
    const churn = state.tracked === null ? overview.churn : null;
    const answerParaId = state.tracked?.paraId ?? null;
    pageView.update({
      title: overview.title, firstTs: overview.firstTs, frame: state.frame, cache,
      wordingsVersion: state.wordingsVersion, churn, answerParaId,
    });
    minimapView.update({ frame: state.frame, cache, wordingsVersion: state.wordingsVersion, churn, answerParaId });
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
