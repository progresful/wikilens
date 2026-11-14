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
