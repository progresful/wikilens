// "Then and now". A question is ranked against every wording a paragraph ever had, so the
// wording closest to it may be one the article gave up years ago. These functions say which
// stretch of the paragraph's life that was, and how the wording at the playhead differs.
// Pure functions.
import { diffWords, tokenize } from './diff';
import type { Segment } from './types';

export const QUOTE_CHARS = 320;

const WORD = /[\p{L}\p{N}]/u;

/** Words that are in one wording and not the other. */
export interface WordChange {
  gone: number;
  added: number;
}

/** How long a wording stood: in how many separate stretches, and when the last one ended. */
export interface Standing {
  stretches: number;
  until: number;
}

export interface ThenAndNow {
  /** The first stretch in which the paragraph had the wording closest to the question. */
  closest: Segment;
  /** When the paragraph last stopped reading like that: a wording can be put back more than once. */
  until: number;
  /** How many separate stretches it stood for. */
  stretches: number;
  /** How the wording at the playhead differs from it; null where the paragraph is out of the article. */
  change: WordChange | null;
}

/** The first segment with the closest wording; -1 when no wording was singled out or it is not here. */
export function closestIndex(segments: readonly Segment[], closestHash: string | null): number {
  if (closestHash === null) return -1;
  return segments.findIndex((segment) => segment.kind === 'wording' && segment.hash === closestHash);
}

/** The stretches for which a paragraph had one wording. A wording can be put back more than once. */
export function standing(segments: readonly Segment[], hash: string | null): Standing {
  const stretches = hash === null ? [] : segments.filter((segment) => segment.kind === 'wording' && segment.hash === hash);
  return { stretches: stretches.length, until: Math.max(0, ...stretches.map((segment) => segment.end)) };
}

/** How many words left and how many came between two wordings; punctuation is not counted. */
export function wordChange(from: string, to: string): WordChange {
  const ops = diffWords(tokenize(from), tokenize(to)).filter((op) => WORD.test(op.token));
  return {
    gone: ops.filter((op) => op.type === 'del').length,
    added: ops.filter((op) => op.type === 'ins').length,
  };
}

/**
 * What to say at segment `index` of a paragraph's life: nothing while the closest wording is
 * the one shown (or before the paragraph exists), otherwise when it read like that and how the
 * wording shown differs.
 */
export function thenAndNow(segments: readonly Segment[], index: number, closestHash: string | null): ThenAndNow | null {
  const shown = segments[index];
  const closest = segments[closestIndex(segments, closestHash)];
  if (shown === undefined || closest === undefined || shown.hash === closest.hash) return null;
  const change = shown.kind === 'gap' ? null : wordChange(closest.text ?? '', shown.text ?? '');
  return { closest, ...standing(segments, closest.hash), change };
}

/** A wording for quoting: whole when short, otherwise cut at the limit with an ellipsis. */
export function quote(text: string, limit: number = QUOTE_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}
