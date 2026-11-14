import { describe, expect, it } from 'vitest';

import { cleanQuestion, MAX_QUESTION_CHARS } from '../src/question';

describe('cleanQuestion', () => {
  it('trims and accepts a real question', () => {
    expect(cleanQuestion('  Miksi talvisota alkoi?  ')).toBe('Miksi talvisota alkoi?');
    expect(cleanQuestion('1939')).toBe('1939');
  });

  it('rejects blank and punctuation-only input', () => {
    expect(cleanQuestion('')).toBeNull();
    expect(cleanQuestion('   ')).toBeNull();
    expect(cleanQuestion('?!.')).toBeNull();
  });

  it('rejects a question longer than the server accepts', () => {
    expect(cleanQuestion('a'.repeat(MAX_QUESTION_CHARS))).not.toBeNull();
    expect(cleanQuestion('a'.repeat(MAX_QUESTION_CHARS + 1))).toBeNull();
  });
});
