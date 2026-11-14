// How does a drag across the whole timeline behave on a real article?
//   node scripts/drag-probe.mjs [url] [question]
// Reports frames delivered, long main-thread tasks, and how long the drag took.
import { chromium } from '@playwright/test';

const [url = 'http://127.0.0.1:8000/?article=1256', question = ''] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url);
await page.waitForSelector('.para:not(.pending)', { timeout: 20000 });
await page.waitForTimeout(1500);                       // let the article's texts arrive
if (question !== '') {
  await page.fill('input.question', question);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.para.answer', { timeout: 20000 });
}
await page.evaluate(() => {
  window.__long = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration));
  }).observe({ entryTypes: ['longtask'] });
  window.__frames = 0;
  const tick = () => { window.__frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const count = async () => Number((await page.locator('.sql-count').textContent())?.split(' ')[0] ?? 0);
const box = await page.locator('.track').boundingBox();
const y = box.y + box.height / 2;
const before = await count();
const started = Date.now();
await page.mouse.move(box.x + box.width - 2, y);
await page.mouse.down();
const STEPS = 240;
for (let i = 1; i <= STEPS; i++) {
  await page.mouse.move(box.x + box.width - 2 - ((box.width - 4) * i) / STEPS, y);
  await page.waitForTimeout(12);
}
await page.mouse.up();
const seconds = (Date.now() - started) / 1000;
await page.waitForTimeout(400);
const result = await page.evaluate(() => ({ long: window.__long, frames: window.__frames, pending: document.querySelectorAll('.para.pending').length }));
const queries = (await count()) - before;
process.stdout.write(JSON.stringify({
  dragSeconds: Number(seconds.toFixed(1)), pointerMoves: STEPS, liveQueries: queries,
  queriesPerSecond: Math.round(queries / seconds), animationFrames: result.frames,
  fps: Math.round(result.frames / (seconds + 0.4)), longTasks: result.long.length,
  longestTaskMs: Math.max(0, ...result.long), pendingParagraphsAtEnd: result.pending,
}, null, 2) + '\n');
await browser.close();
