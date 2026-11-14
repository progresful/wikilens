import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickTrackAt, clickTrackPx, envelope, errorEnvelope, QUESTION } from './helpers';

// The tracked paragraph of the fixture article lives like this:
//   2010-03-01 first appears · 2011 text changed · 2012-01-01 10:00 replaced, 10:07 reverted ·
//   2013 removed · 2014 restored unchanged · 2015 text changed · (corpus end)

/** Type a question and press Enter, without waiting for an answer. */
async function type(page: Page, question: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await page.fill('input.question', question);
  await page.keyboard.press('Enter');
}

/** Ask a question and wait until its answer is on the page and the keyboard drives the timeline. */
async function ask(page: Page, question: string = QUESTION): Promise<void> {
  await type(page, question);
  await expect(page.locator('.answer')).toBeVisible();
  await expect(page.locator('.track')).toBeFocused();
}

const back = (page: Page): Promise<void> => page.keyboard.press('ArrowLeft');

test('asking highlights the answer in place with its band on the timeline', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.answer')).toContainText('ilman sodanjulistusta');
  await expect(page.locator('.answer-label')).toHaveText('text changed');
  await expect(page.locator('.answer-life')).toContainText('1 Jan 2015');
  await expect(page.locator('.seg')).toHaveCount(7);
  await expect(page.locator('.seg.gap')).toHaveCount(1);
  await expect(page.locator('.seg.reverted')).toHaveCount(1);
  await expect(page.locator('.para[class*="churn-"]')).toHaveCount(0);       // the tint gives way to the highlight
  await expect(page.locator('.answer-link')).toHaveAttribute('href', 'https://fi.wikipedia.org/?oldid=107');
});

test('stepping back walks the answer through its life', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.answer-label')).toHaveText('text changed');
  await back(page);
  await expect(page.locator('.now-date')).toHaveText('1 Jan 2015');           // first: the start of the current wording
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('restored unchanged');
  await expect(page.locator('.now-date')).toHaveText('1 Jan 2014');
  await back(page);
  await expect(page.locator('.answer.ghost')).toBeVisible();
  await expect(page.locator('.answer-label')).toHaveText('removed');
  await expect(page.locator('.answer-notice')).toContainText('removed');
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('restored unchanged');
  await expect(page.locator('.answer.ghost')).toHaveCount(0);
  await back(page);
  await expect(page.locator('.answer.reverted')).toContainText('lol');
  await expect(page.locator('.answer-label')).toHaveText('replaced, reverted after 7 min');
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('text changed');
  await expect(page.locator('.now-date')).toHaveText('1 Jan 2011');
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('first appears');
  await expect(page.locator('.answer')).toContainText('alkoi marraskuussa 1939');
  await expect(page.locator('.sql-text')).toContainText("AS OF TIMESTAMP '2010-03-01");
});

test('the answer changes without waiting for the page around it', async ({ page }) => {
  await ask(page);
  await back(page);
  await expect(page.locator('.now-date')).toHaveText('1 Jan 2015');
  await page.route('**/api/articles/1/at*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('restored unchanged', { timeout: 300 });
});

test('a changed word is marked as inserted and a dropped one as removed', async ({ page }) => {
  await ask(page);
  for (let i = 0; i < 7; i++) await back(page);
  await expect(page.locator('.answer-label')).toHaveText('first appears');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.answer-label')).toHaveText('text changed');
  await expect(page.locator('.answer .w.ins').filter({ hasText: 'marraskuuta' })).toHaveCount(1);
  await expect(page.locator('.answer .w.ins').filter({ hasText: '30' })).toHaveCount(1);
  await expect(page.locator('.answer')).toContainText('Talvisota alkoi 30. marraskuuta 1939, kun');
});

test('before the answer was written the page says when it first appears', async ({ page }) => {
  await ask(page);
  await page.locator('.chip').nth(1).click();          // the third paragraph, added in 2014
  await expect(page.locator('.answer')).toContainText('Kolmas kappale');
  await clickTrackAt(page, Date.UTC(2011, 6, 1));
  await expect(page.locator('.answer')).toHaveCount(0);
  await expect(page.locator('.first-appearance')).toContainText('first appears on 1 Jan 2014');
});

test('blank question shows a message and sends nothing', async ({ page }) => {
  let asked = 0;
  await page.route('**/ask', async (route) => {
    asked += 1;
    await route.continue();
  });
  await type(page, '   ');
  await expect(page.locator('.ask-message')).toBeVisible();
  await page.fill('input.question', '?!.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ask-message')).toBeVisible();
  expect(asked).toBe(0);
});

test('database failure mid-scrub keeps the answer moving and says so', async ({ page }) => {
  await ask(page);
  await back(page);
  await expect(page.locator('.now-date')).toHaveText('1 Jan 2015');
  await page.route('**/api/articles/1/at*', (route) => route.abort());
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('restored unchanged');
  await expect(page.locator('.error-line')).toBeVisible();
  await page.unroute('**/api/articles/1/at*');
  await back(page);
  await expect(page.locator('.answer-label')).toHaveText('removed');
  await expect(page.locator('.error-line')).toBeHidden();
});

test('a weak match is labelled', async ({ page }) => {
  await ask(page, 'xyzzy');
  await expect(page.locator('.answer-notice')).toContainText('weak match');
});

test('an other-match chip switches the tracked paragraph', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.chip')).toHaveCount(2);
  await page.locator('.chip').first().click();
  await expect(page.locator('.answer')).toContainText('Toinen kappale');
  await expect(page.locator('.seg')).toHaveCount(2);     // its own life; the wording that lasted under a millisecond is not drawn
});

test('embedding service down disables asking but not scrubbing', async ({ page }) => {
  await page.route('**/ask', (route) =>
    route.fulfill({ status: 503, json: errorEnvelope('embedding service unavailable') }));
  await type(page, QUESTION);
  await expect(page.locator('.ask-message')).toContainText('unavailable');
  await clickTrackAt(page, Date.UTC(2010, 6, 1));
  await expect(page.locator('.para.kind-p').first()).toContainText('alkoi marraskuussa 1939');
});

test('clearing the question brings the tint back', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.answer')).toBeVisible();
  await page.locator('.clear-question').click();
  await expect(page.locator('.answer')).toHaveCount(0);
  await expect(page.locator('.para.churn-3')).toContainText('ilman sodanjulistusta');
  await expect(page.locator('.seg')).toHaveCount(0);
});

test('play runs through the answer\'s life to the corpus end and stops', async ({ page }) => {
  test.setTimeout(90_000);
  await ask(page);
  for (let i = 0; i < 7; i++) await back(page);
  await expect(page.locator('.answer-label')).toHaveText('first appears');
  await page.keyboard.press(' ');
  await expect(page.locator('.now-date')).toHaveText('1 Oct 2026', { timeout: 45_000 });
  await expect(page.locator('.answer-label')).toHaveText('text changed');
  await expect(page.locator('.play')).toHaveAttribute('aria-pressed', 'false');
});

test('an article without vectors asks by keyword and says so', async ({ page }) => {
  await page.route('**/api/articles/1/ask', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.mode = 'keyword';
    body.data.matches = body.data.matches.map((match: { distance: number | null; weak: boolean }) => ({
      ...match, distance: null, weak: false,
    }));
    await route.fulfill({ response, json: body });
  });
  await ask(page, 'marraskuuta');
  await expect(page.locator('.mode-keyword')).toHaveText('keyword match');
  await expect(page.locator('.ask-timing')).toHaveCount(0);        // no vector ranking was done, so none is claimed
});

// ---- found in review ----

test('opening another article after scrubbing to before the answer shows that article whole', async ({ page }) => {
  await ask(page);
  await clickTrackPx(page, 2);                                   // January 2010: before the answer was written
  await expect(page.locator('.first-appearance')).toBeVisible();
  await page.locator('select.article-select').selectOption('2');
  await expect(page.locator('h1')).toHaveText('Toinen artikkeli');
  await expect(page.locator('.para:visible')).toHaveCount(3);    // its heading and both paragraphs, none hidden
  await expect(page.locator('.para')).toHaveCount(3);            // and nothing left over from the first article
  await expect(page.locator('.first-appearance')).toBeHidden();
  await expect(page.locator('.answer')).toHaveCount(0);
});

test('an answer that arrives after another article was opened is dropped', async ({ page }) => {
  await page.route('**/api/articles/1/ask', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await type(page, QUESTION);
  await page.locator('select.article-select').selectOption('2');
  await expect(page.locator('h1')).toHaveText('Toinen artikkeli');
  await page.waitForResponse('**/api/articles/1/ask');
  await page.waitForTimeout(300);
  await expect(page.locator('.answer')).toHaveCount(0);
  await expect(page.locator('.seg')).toHaveCount(0);
  await expect(page.locator('.ask-wait')).toHaveCount(0);          // no longer waiting for an answer
  await expect(page.locator('.chip')).toHaveCount(0);
  await expect(page.locator('.para:visible')).toHaveCount(3);
});

test('during play with a question, frames are answered and the answer keeps changing', async ({ page }) => {
  await ask(page);
  for (let i = 0; i < 7; i++) await back(page);
  await expect(page.locator('.answer-label')).toHaveText('first appears');
  const failures: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/at?t=') && !response.ok()) failures.push(response.status());
  });
  await page.keyboard.press(' ');
  await expect(page.locator('.answer-label')).toHaveText('removed', { timeout: 20_000 });
  await expect(page.locator('.error-line')).toBeHidden();
  await page.keyboard.press(' ');
  expect(failures).toEqual([]);
});

test('the contents list marks the section that holds the answer', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.toc-item.has-answer')).toHaveText(/Tausta/);
  await expect(page.locator('.toc-item.has-answer')).toHaveCount(1);
  await page.locator('.clear-question').click();
  await expect(page.locator('.toc-item.has-answer')).toHaveCount(0);
});

test('the overview marks where the answer sits, and gives up the tint', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.mm-bar.mm-answer')).toHaveCount(1);
  await expect(page.locator('.mm-bar[class*="churn-"]')).toHaveCount(0);
  await clickTrackAt(page, Date.UTC(2013, 5, 15));           // the answer was out of the article then
  await expect(page.locator('.mm-bar')).toHaveCount(2);
  await expect(page.locator('.mm-bar.mm-answer')).toHaveCount(0);
});

test('pressing on the overview while the answer plays stops the play, so the article stays where it was put', async ({ page }) => {
  await ask(page);
  await page.keyboard.press(' ');
  await expect(page.locator('.play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mm-bar').first()).toBeAttached();          // the article exists at the playhead
  await page.locator('.mm-map').click({ position: { x: 12, y: 9 } });
  await expect(page.locator('.play')).toHaveAttribute('aria-pressed', 'false');
});

test('only the main mouse button moves the article from the overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 470 });      // a short window, so the small fixture article scrolls
  await page.goto('/');
  await expect(page.locator('.mm-bar')).toHaveCount(4);
  const last = await page.locator('.mm-bar').last().boundingBox();
  if (last === null) throw new Error('the overview has no bars');
  await page.mouse.click(last.x + 2, last.y + last.height / 2, { button: 'right' });
  await page.mouse.move(last.x + 2, last.y - 12);                // and no drag was started by it
  await page.waitForTimeout(150);
  expect(await page.locator('#page-scroll').evaluate((element) => element.scrollTop)).toBe(0);
});

// ---- then and now: the wording closest to the question may be one the article no longer has ----

test('a question that matches an old wording says when the article read like that, and that it differs now', async ({ page }) => {
  await ask(page);                                   // the 2010 wording shares the most words with the question
  const then = page.locator('.closest-match');
  await expect(then).toBeVisible();
  await expect(then.locator('.closest-life')).toHaveText('1 Mar 2010 → 1 Jan 2011 · 10mo');
  await expect(then.locator('.closest-quote')).toHaveText('Talvisota alkoi marraskuussa 1939, kun Neuvostoliitto hyökkäsi Suomeen.');
  await expect(then.locator('.closest-change')).toHaveText('The wording shown below differs: 1 word gone, 4 new.');
  await expect(page.locator('.seg.closest')).toHaveCount(1);
  await expect(page.locator('.closest-here')).toBeHidden();
  await expect(page.locator('#legend')).toContainText('closest to the question');
});

test('a paragraph chosen from the other matches gets its own closest wording', async ({ page }) => {
  await ask(page);
  await page.locator('.chip').first().click();          // "Toinen kappale…": no wording of it shares a word with the question
  await expect(page.locator('.answer')).toContainText('Toinen kappale');
  await expect(page.locator('.closest-match')).toBeHidden();       // all equally far: today's wording is the one named
  await expect(page.locator('.closest-here')).toBeVisible();
  await expect(page.locator('.seg.closest')).toHaveCount(1);
});

test('from today the page jumps to the closest wording, and from there back to today', async ({ page }) => {
  await ask(page);
  await page.locator('.closest-jump').click();
  await expect(page.locator('.now-date')).toHaveText('1 Mar 2010');
  await expect(page.locator('.closest-match')).toBeHidden();              // the closest wording is the one shown
  await expect(page.locator('.closest-here')).toBeVisible();
  await expect(page.locator('.closest-later')).toContainText('It stood until 1 Jan 2011');
  await expect(page.locator('.closest-later')).toContainText('reads differently');
  await page.locator('.closest-latest').click();
  await expect(page.locator('.now-date')).toHaveText('1 Oct 2026');
  await expect(page.locator('.closest-match')).toBeVisible();
  await expect(page.locator('.closest-later')).toBeHidden();
});

test('where the paragraph is out of the article, the closest wording is still pointed to, unstruck', async ({ page }) => {
  await ask(page);
  await clickTrackAt(page, Date.UTC(2013, 5, 15));
  await expect(page.locator('.answer.ghost')).toBeVisible();
  await expect(page.locator('.closest-change')).toHaveText('The paragraph is not in the article at this moment.');
  // Only the removed text is struck through and dimmed, not the box that points to the closest wording.
  await expect(page.locator('.answer.ghost')).toHaveCSS('text-decoration-line', 'none');
  await expect(page.locator('.answer.ghost')).toHaveCSS('opacity', '1');
  await expect(page.locator('.answer.ghost .answer-text')).toHaveCSS('text-decoration-line', 'line-through');
});

test('a question answered by keyword singles out no wording', async ({ page }) => {
  await page.route('**/api/articles/1/ask', (route) => route.fulfill({ json: envelope({
    mode: 'keyword', matches: [{ paraId: 2, distance: null, weak: false, preview: 'Talvisota alkoi', closestHash: null }],
    timeline: [{ kind: 'wording', start: Date.UTC(2010, 2, 1), end: Date.UTC(2026, 9, 1, 23, 59, 59), hash: 'a'.repeat(32),
      text: 'Talvisota alkoi.', revId: 101, label: 'first appears', tone: 0, loose: false, reverted: false }],
    embedMs: 0, rankMs: 1, sql: 'SELECT 1',
  }) }));
  await ask(page, 'talvisota');
  await expect(page.locator('.closest-match')).toBeHidden();
  await expect(page.locator('.closest-here')).toBeHidden();
  await expect(page.locator('.seg.closest')).toHaveCount(0);
  await expect(page.locator('#legend')).not.toContainText('closest');       // nothing on the band to explain
});

test('a closest wording that came back several times is given with its whole span', async ({ page }) => {
  // The 2011 wording stood three times: 2011, again after a revert in 2012, and again in 2014 after a removal.
  await page.route('**/api/articles/1/ask', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.matches[0].closestHash = body.data.timeline[1].hash;
    await route.fulfill({ response, json: body });
  });
  await ask(page);
  await expect(page.locator('.closest-life')).toHaveText('first 1 Jan 2011, last until 1 Jan 2015 · stood 3 times');
  await expect(page.locator('.seg.closest')).toHaveCount(3);
  await page.locator('.closest-jump').click();
  await expect(page.locator('.now-date')).toHaveText('1 Jan 2011');
  // Said of the wording, not of this one stretch of it, which ended in 2012.
  await expect(page.locator('.closest-later')).toContainText('It stood 3 times, last until 1 Jan 2015.');
});

// ---- found on the deployed site: on a slow connection the article's text can arrive after the answer ----

async function answerFullyInView(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const view = document.querySelector('#page-scroll')?.getBoundingClientRect();
    const answer = document.querySelector('.para.answer')?.getBoundingClientRect();
    return view !== undefined && answer !== undefined && answer.top >= view.top - 1 && answer.bottom <= view.bottom + 1;
  });
}

test('when the page around the answer changes size, the answer stays in view', async ({ page }) => {
  await ask(page);
  expect(await answerFullyInView(page)).toBe(true);
  // What late-arriving text does: everything above the answer grows.
  await page.evaluate(() => { (document.querySelector('.para.kind-h') as HTMLElement).style.minHeight = '520px'; });
  await expect.poll(() => answerFullyInView(page)).toBe(true);
});

test('once the reader has scrolled away by hand, a change of size does not pull the page back', async ({ page }) => {
  await ask(page);
  await page.evaluate(() => { (document.querySelector('.para.kind-h') as HTMLElement).style.minHeight = '520px'; });
  await expect.poll(() => answerFullyInView(page)).toBe(true);
  const scroller = page.locator('#page-scroll');
  const held = await scroller.evaluate((element) => element.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, -300);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(held - 150);
  const left = await scroller.evaluate((element) => element.scrollTop);
  await page.evaluate(() => { (document.querySelector('.para.kind-h') as HTMLElement).style.minHeight = '560px'; });
  await page.waitForTimeout(400);
  // Being pulled back to the answer would move the page some 300 pixels; it stays about where it was left.
  expect(Math.abs(await scroller.evaluate((element) => element.scrollTop) - left)).toBeLessThan(60);
  expect(await answerFullyInView(page)).toBe(false);
});
