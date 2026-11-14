// Run with: node --test tests/
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { around, cameraAt, sceneTime, viewOf } from '../src/camera.ts';
import type { Rect, Shot } from '../src/camera.ts';

const CANVAS = { w: 1920, h: 1080 };
const linear = (k: number): number => k;

describe('viewOf', () => {
  it('fills the canvas with a rectangle of the same shape', () => {
    assert.deepEqual(viewOf({ x: 0, y: 0, w: 1600, h: 900 }, CANVAS), { scale: 1.2, x: 0, y: 0 });
  });

  it('puts the middle of the rectangle in the middle of the canvas', () => {
    assert.deepEqual(viewOf({ x: 400, y: 225, w: 800, h: 450 }, CANVAS), { scale: 2.4, x: -960, y: -540 });
  });

  it('shows the whole of a rectangle of another shape, with room above and below', () => {
    assert.deepEqual(viewOf({ x: 0, y: 0, w: 1600, h: 450 }, CANVAS), { scale: 1.2, x: 0, y: 270 });
  });
});

describe('cameraAt', () => {
  const a: Rect = { x: 0, y: 0, w: 1600, h: 900 };
  const b: Rect = { x: 400, y: 200, w: 800, h: 450 };
  const shots: Shot[] = [{ at: 0, rect: a }, { at: 2, rect: b, move: 1 }];

  it('holds a shot until the move to the next one begins', () => {
    assert.deepEqual(cameraAt(shots, 0.5, linear), a);
    assert.deepEqual(cameraAt(shots, 1, linear), a);
  });

  it('is partway between two shots during the move, and on the new shot from its time on', () => {
    assert.deepEqual(cameraAt(shots, 1.5, linear), { x: 200, y: 100, w: 1200, h: 675 });
    assert.deepEqual(cameraAt(shots, 2, linear), b);
    assert.deepEqual(cameraAt(shots, 30, linear), b);
  });

  it('starts on the first shot, whenever that is timed', () => {
    assert.deepEqual(cameraAt([{ at: 3, rect: b }], 0, linear), b);
  });

  it('refuses a film with no shots', () => {
    assert.throws(() => cameraAt([], 0, linear), /no shots/);
  });
});

describe('around', () => {
  it('frames boxes with room around them, in the shape of the canvas', () => {
    const framed = around([{ x: 100, y: 100, w: 200, h: 100 }], 20, 16 / 9);
    assert.equal(framed.w / framed.h, 16 / 9);
    assert.equal(framed.x + framed.w / 2, 200);            // still centred on the box
    assert.equal(framed.y + framed.h / 2, 150);
    assert.ok(framed.w >= 240 && framed.h >= 140);         // the box and its margin fit
    assert.equal(framed.h, 140);                           // and nothing is wasted on the tight side
  });

  it('frames several boxes together', () => {
    const framed = around([{ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 500, w: 100, h: 100 }], 0, 1);
    assert.deepEqual(framed, { x: -100, y: 0, w: 600, h: 600 });      // 400 wide and 600 tall: widened to a square about its middle
  });
});

describe('sceneTime', () => {
  it('turns a moment of a clip into a moment of the scene that plays it', () => {
    assert.equal(sceneTime(7, { from: 1, rate: 1 }), 6);
    assert.equal(sceneTime(7, { from: 1, rate: 2 }), 3);
  });
});
