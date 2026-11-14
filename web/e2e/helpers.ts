import type { Page } from '@playwright/test';

// The fixture article "Testisota": first revision 1 March 2010, so the timeline runs from
// 1 January 2010 to the corpus end.
export const RANGE_FIRST = Date.UTC(2010, 0, 1);
export const RANGE_END = Date.UTC(2026, 9, 1, 23, 59, 59);

// Shares many words with the fixture's first paragraph, which is how the stub embedder scores.
export const QUESTION = 'Milloin Neuvostoliitto hyökkäsi Suomeen, kun talvisota alkoi 1939?';

/** Click the timeline at a moment in time. */
export async function clickTrackAt(page: Page, t: number): Promise<void> {
  const box = await page.locator('.track').boundingBox();
  if (box === null) throw new Error('the timeline track is not on the page');
  const fraction = (t - RANGE_FIRST) / (RANGE_END - RANGE_FIRST);
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

/** Click the timeline a number of pixels from its left edge. */
export async function clickTrackPx(page: Page, px: number): Promise<void> {
  const box = await page.locator('.track').boundingBox();
  if (box === null) throw new Error('the timeline track is not on the page');
  await page.mouse.click(box.x + px, box.y + box.height / 2);
}

export function envelope(data: unknown): Record<string, unknown> {
  return { success: true, data, error: null, meta: null };
}

export function errorEnvelope(message: string): Record<string, unknown> {
  return { success: false, data: null, error: message, meta: null };
}
