import { describe, expect, it } from 'vitest';

import { createWordingCache } from '../src/wordingCache';

describe('wording cache', () => {
  it('reports only the hashes it does not have, without duplicates', () => {
    const cache = createWordingCache();
    cache.put({ aa: { kind: 'p', text: 'yksi' } });
    expect(cache.missing(['aa', 'bb', 'bb', 'cc'])).toEqual(['bb', 'cc']);
  });

  it('returns what was put', () => {
    const cache = createWordingCache();
    cache.put({ aa: { kind: 'h', text: 'Tausta' } });
    expect(cache.get('aa')).toEqual({ kind: 'h', text: 'Tausta' });
    expect(cache.get('zz')).toBeUndefined();
  });

  it('keeps earlier entries when more are added', () => {
    const cache = createWordingCache();
    cache.put({ aa: { kind: 'p', text: 'yksi' } });
    cache.put({ bb: { kind: 'li', text: 'kaksi' } });
    expect(cache.missing(['aa', 'bb'])).toEqual([]);
  });
});
