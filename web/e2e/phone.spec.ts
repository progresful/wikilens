import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { envelope, QUESTION } from './helpers';

// A phone held upright. The timeline and the question stay on screen; the contents list and the
// overview strip, which need width, are left out; the query, the key and the credits follow the
// article instead of standing beside it.
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

  async function open(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.locator('.para.kind-p')).toHaveCount(3);
  }

  test('nothing is wider than the screen', async ({ page }) => {
    await open(page);
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth, screen: window.innerWidth,
      article: document.querySelector('#page-scroll')?.scrollWidth, articleView: document.querySelector('#page-scroll')?.clientWidth,
    }));
    expect(widths.page).toBeLessThanOrEqual(widths.screen);
    expect(widths.article).toBeLessThanOrEqual(widths.articleView ?? 0);
    for (const selector of ['.vector-header', '.title-row', '.history-band', '.track']) {
      const box = await page.locator(selector).boundingBox();
      if (box === null) throw new Error(`${selector} is not on the page`);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  });

  test('with the search box and example questions there, still nothing is wider than the screen', async ({ page }) => {
    // What the real data has and the fixture alone does not: thousands of history-only articles
    // (so the search box shows) and long example questions.
    const article = (pageId: number, title: string, tier: number, reviewed: boolean) => ({
      pageId, title, revisions: 10, firstTs: Date.UTC(2010, 2, 1), lastTs: Date.UTC(2017, 0, 1), tier, reviewed,
      questions: reviewed ? [{ fi: 'Onko presidentin virka-auto Mercedes-Benz?', en: 'Is the president’s official car a Mercedes-Benz?' }] : [],
    });
    await page.route('**/api/articles', (route) => route.fulfill({
      json: envelope([article(1, 'Testisota', 1, true), article(2, 'Toinen artikkeli', 2, false)]),
    }));
    await open(page);
    await expect(page.locator('input.article-search')).toBeVisible();
    await expect(page.locator('.example-question')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const selector of ['.vector-header', 'input.article-search', 'select.article-select', '.history-band', 'button.ask-button', '.track', '#page-scroll']) {
      const box = await page.locator(selector).boundingBox();
      if (box === null) throw new Error(`${selector} is not on the page`);
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(390);
    }
    await page.locator('button.ask-button').tap({ trial: true });          // nothing lies over the button
  });

  test('the question, the transport and the timeline are on screen, with room left to read', async ({ page }) => {
    await open(page);
    for (const selector of ['input.question', 'button.ask-button', '.play', '.now-date', '.track']) {
      await expect(page.locator(selector)).toBeInViewport();
    }
    const article = await page.locator('#page-scroll').boundingBox();
    if (article === null) throw new Error('the article is not on the page');
    expect(article.height).toBeGreaterThanOrEqual(330);          // a good third of the screen is article
    await expect(page.locator('#toc')).toBeHidden();
    await expect(page.locator('#minimap')).toBeHidden();
  });

  test('the query, the key and the credits follow the article', async ({ page }) => {
    await open(page);
    await expect(page.locator('#page-scroll .sql-text')).toContainText('FOR SYSTEM_TIME AS OF');
    await expect(page.locator('#page-scroll #legend')).toContainText('every edit, by month');
    await expect(page.locator('#page-scroll .credit')).toContainText('CC BY-SA 4.0');
    await expect(page.locator('#page-scroll .about-toggle')).toBeAttached();
    // They come after the article's text, and are reached by scrolling it.
    const order = await page.evaluate(() => {
      const top = (selector: string): number => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
      return { article: top('#page'), query: top('.sql-text'), credit: top('.credit') };
    });
    expect(order.query).toBeGreaterThan(order.article);
    expect(order.credit).toBeGreaterThan(order.query);
  });

  test('a tap on the timeline goes to that moment', async ({ page }) => {
    await open(page);
    await expect(page.locator('.now-date')).toHaveText('1 Oct 2026');
    const track = await page.locator('.track').boundingBox();
    if (track === null) throw new Error('the timeline is not on the page');
    await page.touchscreen.tap(track.x + track.width * 0.3, track.y + track.height / 2);
    await expect(page.locator('.now-date')).toHaveText(/2014|2015/);
    await expect(page.locator('.sql-text')).toContainText(/AS OF TIMESTAMP '201[45]-/);
  });

  test('a question can be asked, and the answer comes into view', async ({ page }) => {
    await open(page);
    await page.locator('input.question').fill(QUESTION);
    await page.locator('button.ask-button').tap();
    await expect(page.locator('.answer')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const view = document.querySelector('#page-scroll')?.getBoundingClientRect();
      const answer = document.querySelector('.para.answer')?.getBoundingClientRect();
      return view !== undefined && answer !== undefined && answer.top >= view.top - 1 && answer.top < view.bottom - 60;
    })).toBe(true);
    await expect(page.locator('.clear-question')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('the about panel fits the screen and closes again', async ({ page }) => {
    await open(page);
    const toggle = page.locator('.about-toggle');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.tap();
    const about = page.locator('.about');
    await expect(about).toContainText('2 articles');
    const box = await about.boundingBox();
    if (box === null) throw new Error('the about panel is not on the page');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(780);
    await page.locator('.about-close').tap();
    await expect(about).toBeHidden();
  });
});

test('turning a phone-sized window into a wide one puts the columns back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  await expect(page.locator('#page-scroll .sql-text')).toBeAttached();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.stage > .rail .sql-text')).toBeVisible();
  await expect(page.locator('.side-col > .page-foot .credit')).toBeVisible();
  await expect(page.locator('#page-scroll .rail')).toHaveCount(0);
  await expect(page.locator('#toc')).toBeVisible();
  await expect(page.locator('#minimap')).toBeVisible();
});

test('on a phone the year labels under the timeline do not run into each other', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  await expect(page.locator('.year-label').first()).toBeVisible();
  const boxes = await page.locator('.year-label').evaluateAll((labels) => labels.map((label) => {
    const box = label.getBoundingClientRect();
    return { left: box.left, right: box.right };
  }));
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left - boxes[i - 1]!.right).toBeGreaterThanOrEqual(8);
});
