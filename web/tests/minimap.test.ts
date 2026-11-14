import { describe, expect, it } from 'vitest';

import { barWidthPercent, blockAt, minimapPitch, visibleSpan } from '../src/minimap';

describe('minimapPitch', () => {
  it('gives a short article roomy bars, so its growth over the years shows', () => {
    expect(minimapPitch(10, 500)).toEqual({ pitch: 5, bar: 4 });
    expect(minimapPitch(0, 500)).toEqual({ pitch: 5, bar: 4 });
  });

  it('squeezes a long article so every block still fits', () => {
    expect(minimapPitch(200, 500)).toEqual({ pitch: 2.5, bar: 1.5 });
    const dense = minimapPitch(500, 500);
    expect(dense.pitch).toBe(1);
    expect(dense.bar).toBeCloseTo(0.6);
  });

  it('uses roomy bars until the height is known', () => {
    expect(minimapPitch(200, 0)).toEqual({ pitch: 5, bar: 4 });
  });
});

describe('barWidthPercent', () => {
  it('grows with the length of the text, between a quarter and the full width', () => {
    expect(barWidthPercent(0)).toBe(25);
    expect(barWidthPercent(300)).toBe(62.5);
    expect(barWidthPercent(600)).toBe(100);
    expect(barWidthPercent(5000)).toBe(100);
  });

  it('draws a text that is not loaded yet at a middling width', () => {
    expect(barWidthPercent(undefined)).toBe(62.5);
  });
});

describe('visibleSpan', () => {
  const boxes = [{ top: 0, height: 100 }, { top: 100, height: 100 }, { top: 200, height: 100 }];

  it('says which blocks are in view, counting parts of a block', () => {
    expect(visibleSpan(boxes, 50, 100)).toEqual({ from: 0.5, to: 1.5 });
    expect(visibleSpan(boxes, 0, 300)).toEqual({ from: 0, to: 3 });
  });

  it('treats the space above and between blocks as the start of the next block', () => {
    const spaced = [{ top: 40, height: 100 }, { top: 150, height: 50 }];
    expect(visibleSpan(spaced, 0, 40)).toEqual({ from: 0, to: 0 });
    expect(visibleSpan(spaced, 145, 30)).toEqual({ from: 1, to: 1.5 });
    expect(visibleSpan(spaced, 0, 1000)).toEqual({ from: 0, to: 2 });
  });

  it('passes over a block that takes no room, and gives nothing for an empty article', () => {
    expect(visibleSpan([{ top: 0, height: 0 }, { top: 0, height: 100 }], 50, 50)).toEqual({ from: 1.5, to: 2 });
    expect(visibleSpan([], 0, 100)).toBeNull();
  });
});

describe('blockAt', () => {
  it('finds the block under a point of the overview, and how far down it', () => {
    const spot = blockAt(12, 5, 10);
    expect(spot?.index).toBe(2);
    expect(spot?.within).toBeCloseTo(0.4);      // 12 / 5 is not exact in floating point
  });

  it('keeps to the first and last block outside the bars', () => {
    expect(blockAt(-3, 5, 10)).toEqual({ index: 0, within: 0 });
    expect(blockAt(999, 5, 10)).toEqual({ index: 9, within: 1 });
  });

  it('finds nothing in an empty overview', () => {
    expect(blockAt(5, 5, 0)).toBeNull();
  });
});
