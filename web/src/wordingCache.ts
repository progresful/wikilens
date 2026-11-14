// Paragraph texts by content hash. A wording never changes once it has a hash, so a text
// fetched once is good for every later frame; a scrub frame then only carries hashes.
import type { Wording } from './types';

export interface WordingCache {
  get(hash: string): Wording | undefined;
  /** The hashes not in the cache yet, each once, in the order given. */
  missing(hashes: readonly string[]): string[];
  put(entries: Readonly<Record<string, Wording>>): void;
}

export function createWordingCache(): WordingCache {
  const known = new Map<string, Wording>();
  return {
    get: (hash) => known.get(hash),
    missing: (hashes) => [...new Set(hashes)].filter((hash) => !known.has(hash)),
    put: (entries) => {
      for (const [hash, wording] of Object.entries(entries)) known.set(hash, wording);
    },
  };
}
