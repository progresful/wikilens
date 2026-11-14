import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickTrackAt, errorEnvelope, QUESTION } from './helpers';

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
