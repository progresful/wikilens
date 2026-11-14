// Run with: node --test tests/narration.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { narrationFaults } from '../src/narration.ts';

describe('narrationFaults', () => {
  it('finds nothing wrong with lines that follow one another inside the film', () => {
    assert.deepEqual(narrationFaults([{ id: 'a', from: 0, to: 2 }, { id: 'b', from: 2.1, to: 5 }], 6), []);
  });

  it('names two lines that would be spoken at once', () => {
    assert.deepEqual(narrationFaults([{ id: 'a', from: 0, to: 2.5 }, { id: 'b', from: 2.1, to: 5 }], 6),
      ['"b" starts at 2.10 s, before "a" has ended at 2.50 s']);
  });

  it('names a line that runs past the end of the film', () => {
    assert.deepEqual(narrationFaults([{ id: 'a', from: 4, to: 6.5 }], 6), ['"a" ends at 6.50 s, after the film has ended at 6.00 s']);
  });

  it('checks the lines in the order they are spoken, whatever order they are given in', () => {
    assert.deepEqual(narrationFaults([{ id: 'b', from: 3, to: 5 }, { id: 'a', from: 0, to: 2 }], 6), []);
  });
});
