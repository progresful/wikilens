// Screenshots of the running app, for checking the real-data screen by eye and for the README.
//   node scripts/screenshot.mjs <out-dir> [url] [question] [width]x[height]
// Needs the API (python -m wikilens.api) and the web server running.
import { chromium } from '@playwright/test';

const [outDir = 'screenshots', url = 'http://127.0.0.1:5173/', question = '', size = '1440x900'] = process.argv.slice(2);
const [width = 1440, height = 900] = size.split('x').map(Number);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(message.text());
});
page.on('pageerror', (error) => problems.push(String(error)));

async function clickTrack(fraction) {
  const box = await page.locator('.track').boundingBox();
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
  await page.waitForTimeout(700);
}

await page.goto(url);
await page.waitForSelector('.para:not(.pending)', { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/01-landing.png` });

await clickTrack(0.35);
await page.screenshot({ path: `${outDir}/02-earlier.png` });

if (question !== '') {
  await page.fill('input.question', question);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.para.answer', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/03-asked.png` });
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(450);
  }
  await page.screenshot({ path: `${outDir}/04-stepped-back.png` });
  // Back at the end of the corpus: where "then and now" shows, if the closest wording is an old one.
  await clickTrack(0.9995);
  await page.screenshot({ path: `${outDir}/05-today.png` });
}

const stats = await page.evaluate(() => ({
  paragraphs: document.querySelectorAll('.para').length,
  pending: document.querySelectorAll('.para.pending').length,
  date: document.querySelector('.now-date')?.textContent,
  sql: document.querySelector('.sql-text')?.textContent?.slice(0, 120),
  ms: document.querySelector('.sql-ms')?.textContent,
  error: document.querySelector('.error-line')?.textContent,
}));
process.stdout.write(`${JSON.stringify({ stats, problems }, null, 2)}\n`);
await browser.close();
