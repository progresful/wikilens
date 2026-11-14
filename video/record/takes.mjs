// The takes of the film, performed on the real page at http://127.0.0.1:8000.
//   node record/takes.mjs            every take
//   node record/takes.mjs ask then   only these
// Each take writes public/footage/<name>.mp4 and <name>.json. The API (python -m wikilens.api,
// or scripts/demo.sh) and Ollama must be running, with the four story articles embedded.
import path from 'node:path';

import { record } from './capture.mjs';

const SITE = process.env.WIKILENS_URL ?? 'http://127.0.0.1:8000';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public/footage');
const FRAMES = path.join(ROOT, '.frames');

const SUOMETTUMINEN = 5261;
const PRESIDENT = 1069;
const TALVISOTA = 1256;

const linear = (k) => k;

async function ready(page) {
  await page.waitForSelector('.para:not(.pending)', { timeout: 20_000 });
  await page.waitForSelector('.toc-item', { timeout: 20_000 });
  await page.waitForTimeout(1200);          // the article's texts and the overview strip settle
}

function open(name, pageId) {
  return record({ name, url: `${SITE}/?article=${pageId}`, outDir: OUT, framesDir: FRAMES, ready });
}

/** The places every take's camera may want. */
async function layout(stage) {
  await stage.box('band', '.history-band');
  await stage.box('article', '#page-scroll');
  await stage.box('contents', '#toc');
  await stage.box('overview', '#minimap');
  await stage.box('rail', '.rail');
  await stage.box('query', '.sql-box');
  await stage.box('year', '.year-box');
  await stage.box('title', '.title-row');
  return stage.box('track', '.track');
}

const TAKES = {
  // Ask once, then drag the answer back through twenty years and step forward change by change.
  async ask() {
    const stage = await open('ask', SUOMETTUMINEN);
    const track = await layout(stage);
    const middle = track.y + track.height / 2;
    stage.mark('landing');
    await stage.wait(1500);
    await stage.glideTo('input.question', { fx: 0.3, ms: 850 });
    await stage.click();
    await stage.wait(250);
    stage.mark('typing');
    await stage.type('Who coined the term Finlandization?');
    stage.mark('typed');
    await stage.wait(350);
    await stage.glideTo('button.ask-button', { ms: 420 });
    await stage.click();
    stage.mark('asked');
    await stage.page.waitForSelector('.para.answer', { timeout: 30_000 });
    stage.mark('answered');
    await stage.wait(900);                  // the page centres the answer
    await stage.box('answer', '.para.answer');
    await stage.wait(1900);

    await stage.glide({ x: track.x + track.width - 1, y: middle }, 800);
    await stage.wait(200);
    await stage.page.mouse.down();
    stage.mark('drag');
    await stage.glide({ x: track.x + track.width * 0.62, y: middle }, 2600);
    await stage.wait(350);
    // Mid-2009: the next changes from here are real rewordings, not a removal put back a minute later.
    await stage.glide({ x: track.x + track.width * 0.238, y: middle }, 3600);
    await stage.wait(500);
    await stage.page.mouse.up();
    stage.mark('dragged');
    await stage.wait(500);
    await stage.glideTo('.rail', { fy: 0.7, ms: 700 });      // out of the close-ups that follow

    stage.mark('steps');
    const seen = [];
    for (let step = 0; step < 5; step++) {
      await stage.page.keyboard.press('ArrowRight');
      stage.mark(`step${step + 1}`);
      await stage.wait(1150);
      seen.push(`${await stage.page.locator('.now-date').textContent()}: ${await stage.page.locator('.answer-label').textContent()}`);
    }
    process.stdout.write(`ask: the steps showed ${seen.join(' · ')}\n`);
    await stage.box('answerLater', '.para.answer');
    stage.mark('end');
    return stage.finish();
  },

  // A question about what the article used to say: today's wording, the old one, and the jump to it.
  async then() {
    const stage = await open('then', PRESIDENT);
    await layout(stage);
    stage.mark('landing');
    await stage.wait(1000);
    await stage.glideTo('.example-question:has-text("Is the president")', { ms: 900 });
    await stage.wait(200);
    await stage.click();
    stage.mark('asked');
    await stage.page.waitForSelector('.closest-match:not([hidden])', { timeout: 30_000 });
    stage.mark('answered');
    await stage.wait(900);
    await stage.box('answer', '.para.answer');
    await stage.box('then', '.closest-match');
    await stage.wait(3600);                 // time to read the box
    await stage.glideTo('.closest-jump', { ms: 800 });
    await stage.wait(300);
    await stage.click();
    stage.mark('jumped');
    await stage.wait(350);
    await stage.glideTo('.rail', { fy: 0.7, ms: 700 });      // off the words that are changing
    await stage.box('answerThen', '.para.answer');
    await stage.wait(4200);
    stage.mark('end');
    return stage.finish();
  },

  // No question: from the first revision, press play and let the article grow to today.
  async grow() {
    const stage = await open('grow', TALVISOTA);
    const track = await layout(stage);
    const middle = track.y + track.height / 2;
    stage.mark('landing');
    await stage.wait(600);
    await stage.glide({ x: track.x + track.width * 0.012, y: middle }, 900);
    await stage.click();
    stage.mark('first');
    await stage.wait(900);
    await stage.glideTo('.play', { ms: 600 });
    await stage.click();
    stage.mark('play');
    await stage.glide({ x: track.x + track.width * 0.5, y: middle + 420 }, 700);
    await stage.page.waitForSelector('.play[aria-pressed="false"]', { timeout: 40_000 });
    stage.mark('played');
    await stage.wait(900);
    stage.mark('end');
    return stage.finish();
  },

  // The query behind every frame: a steady drag back and forth while the panel keeps up.
  async query() {
    const stage = await open('query', TALVISOTA);
    const track = await layout(stage);
    const middle = track.y + track.height / 2;
    stage.mark('landing');
    await stage.wait(500);
    await stage.glide({ x: track.x + track.width - 1, y: middle }, 700);
    await stage.page.mouse.down();
    stage.mark('drag');
    await stage.glide({ x: track.x + track.width * 0.3, y: middle }, 3400, linear);
    await stage.glide({ x: track.x + track.width * 0.85, y: middle }, 3000, linear);
    await stage.glide({ x: track.x + track.width * 0.5, y: middle }, 2200, linear);
    await stage.page.mouse.up();
    stage.mark('dragged');
    await stage.wait(700);
    stage.mark('end');
    return stage.finish();
  },
};

/** Load the embedding model before any take, so the timing shown on screen is the usual one, not a cold start. */
async function warmUp() {
  const response = await fetch(`${SITE}/api/articles/${SUOMETTUMINEN}/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'warm up' }),
  });
  if (!response.ok) throw new Error(`the site at ${SITE} did not answer a question (${response.status}): is Ollama running?`);
}

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(TAKES);
await warmUp();
for (const name of names) {
  const take = TAKES[name];
  if (take === undefined) throw new Error(`no take is called ${name}; there are: ${Object.keys(TAKES).join(', ')}`);
  const report = await take();
  process.stdout.write(`${name}: ${report.seconds} s, ${report.capturedFrames} frames`
    + `${report.problems.length > 0 ? `, page errors: ${report.problems.join(' | ')}` : ''}\n`);
}
