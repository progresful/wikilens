import { expect, test } from '@playwright/test';

import { clickTrackAt, clickTrackPx, envelope, errorEnvelope } from './helpers';

test('opens the fixture article at the corpus end, tinted by churn', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Testisota');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await expect(page.locator('.para.kind-h')).toHaveText('Tausta');
  await expect(page.locator('.para.churn-3')).toContainText('ilman sodanjulistusta');   // four wordings
  await expect(page.locator('.now-date')).toHaveText('1 Oct 2026');
  await expect(page.locator('.bar').first()).toBeAttached();
});

test('clicking the timeline at 2010 shows the first wording and the query that fetched it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await clickTrackAt(page, Date.UTC(2010, 6, 1));
  await expect(page.locator('.para.kind-p').first()).toContainText('alkoi marraskuussa 1939');
  await expect(page.locator('.para.kind-p')).toHaveCount(2);
  await expect(page.locator('.sql-text')).toContainText("FOR SYSTEM_TIME AS OF TIMESTAMP '2010-");
  await expect(page.locator('.sql-ms')).toHaveText(/\d+(\.\d+)? ms/);
  await expect(page.locator('.big-year')).toHaveText('2010');
});

test('before the first revision the page says so', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await clickTrackPx(page, 2);        // the range starts on 1 Jan 2010; the first revision is 1 Mar 2010
  await expect(page.locator('.page-empty')).toContainText('first revision');
  await expect(page.locator('.para')).toHaveCount(0);
});

test('markup in article text is shown as text', async ({ page }) => {
  const hostile = '<img src=x onerror="window.__hostile=1">';
  await page.route('**/api/wordings*', async (route) => {
    const hashes = new URL(route.request().url()).searchParams.get('hashes')?.split(',') ?? [];
    await route.fulfill({ json: envelope(Object.fromEntries(hashes.map((h) => [h, { kind: 'p', text: hostile }]))) });
  });
  await page.goto('/');
  await expect(page.locator('.para').first()).toHaveText(hostile);
  expect(await page.evaluate(() => (window as unknown as { __hostile?: number }).__hostile)).toBeUndefined();
  await expect(page.locator('.page img')).toHaveCount(0);
});

test('the page footer credits Wikipedia and says the text is simplified', async ({ page }) => {
  await page.goto('/');
  const credit = page.locator('.credit');
  await expect(credit).toContainText('CC BY-SA 4.0');
  await expect(credit).toContainText('simplified');
  await expect(credit.locator('a[href*="fi.wikipedia.org"]')).toBeVisible();
});

test('a database error shows one plain line, and it clears when the database is back', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await page.route('**/api/articles/1/at*', (route) =>
    route.fulfill({ status: 503, json: errorEnvelope('database unavailable') }));
  await clickTrackAt(page, Date.UTC(2012, 0, 1));
  await expect(page.locator('.error-line')).toContainText('database unavailable');
  await page.unroute('**/api/articles/1/at*');
  await clickTrackAt(page, Date.UTC(2014, 6, 1));
  await expect(page.locator('.error-line')).toBeHidden();
});

test('the picker lists the article and has it selected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('select.article-select')).toHaveValue('1');
  await expect(page.locator('select.article-select option')).toHaveText(['Testisota']);
});

test('space plays to the corpus end and stops', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await clickTrackAt(page, Date.UTC(2020, 5, 1));   // mid-year: a click exactly on 1 January can land a pixel early
  await expect(page.locator('.big-year')).toHaveText('2020');
  await page.keyboard.press(' ');
  await expect(page.locator('.now-date')).toHaveText('1 Oct 2026', { timeout: 15_000 });
  await expect(page.locator('.play')).toHaveAttribute('aria-pressed', 'false');
});

test('the SQL panel can be collapsed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sql-text')).toBeVisible();
  await page.locator('.sql-toggle').click();
  await expect(page.locator('.sql-text')).toBeHidden();
});

test('the about panel shows counts read from the database', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.about')).toBeHidden();
  await page.locator('.about-toggle').click();
  const about = page.locator('.about');
  await expect(about).toBeVisible();
  await expect(about).toContainText('1 article');
  await expect(about).toContainText('10 revisions');
  await expect(about).toContainText('8 vectors');
  await expect(about).toContainText('MariaDB 12.');
  await expect(about).toContainText('1 Oct 2026');
  await page.locator('.about-toggle').click();
  await expect(about).toBeHidden();
});

test('history-only articles are found by typing; the list holds the articles with the full experience', async ({ page }) => {
  const article = (pageId: number, title: string, tier: number, reviewed: boolean) => ({
    pageId, title, revisions: 10, firstTs: Date.UTC(2010, 2, 1), lastTs: Date.UTC(2017, 0, 1), tier, reviewed,
    questions: reviewed ? [{ fi: 'Milloin?', en: 'When?' }] : [],
  });
  await page.route('**/api/articles', (route) => route.fulfill({
    json: envelope([article(1, 'Testisota', 1, true), article(7, 'Toinen artikkeli', 1, false), article(9, 'Kolmas artikkeli', 2, false)]),
  }));
  await page.goto('/');
  await expect(page.locator('select.article-select option')).toHaveText(['Testisota', 'Toinen artikkeli']);
  await expect(page.locator('select.article-select optgroup')).toHaveCount(2);
  const search = page.locator('input.article-search');
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute('placeholder', /1 more article/);
  await expect(page.locator('datalist#more-articles option')).toHaveCount(1);
  await expect(page.locator('.example-question')).toHaveText(['Milloin?', 'When?']);
});

test('with only full-experience articles there is no search box', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('select.article-select')).toHaveValue('1');
  await expect(page.locator('input.article-search')).toHaveCount(0);
});
