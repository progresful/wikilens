// The API's JSON, as schemas. Types are inferred from them, so the two cannot drift apart.
// Times are epoch milliseconds (UTC); hashes are 32 hex characters.
import { z } from 'zod';

export interface TimeRange {
  first: number;
  end: number;
}

export const frameBlockSchema = z.object({
  paraId: z.number().int(),
  hash: z.string(),
  revId: z.number().int(),
});

export const frameSchema = z.object({
  t: z.number(),
  blocks: z.array(frameBlockSchema),
  sql: z.string(),
  dbMs: z.number(),
});

export const segmentSchema = z.object({
  kind: z.enum(['wording', 'gap']),
  start: z.number(),
  end: z.number(),
  hash: z.string().nullable(),
  text: z.string().nullable(),
  revId: z.number().int().nullable(),
  label: z.string(),
  tone: z.number().int(),
  loose: z.boolean(),
  reverted: z.boolean(),
});

export const matchSchema = z.object({
  paraId: z.number().int(),
  distance: z.number().nullable(),
  weak: z.boolean(),
  preview: z.string(),
  // The wording of this paragraph closest to the question, over its whole history; null without vectors.
  closestHash: z.string().nullable(),
});

export const askResultSchema = z.object({
  mode: z.enum(['vector', 'keyword']),
  matches: z.array(matchSchema),
  timeline: z.array(segmentSchema),
  embedMs: z.number(),
  rankMs: z.number(),
  sql: z.string(),
});

export const wordingSchema = z.object({
  kind: z.enum(['p', 'li', 'h']),
  text: z.string(),
});

export const wordingsSchema = z.record(z.string(), wordingSchema);

export const overviewSchema = z.object({
  pageId: z.number().int(),
  title: z.string(),
  firstTs: z.number(),
  lastTs: z.number(),
  corpusEnd: z.number(),
  bars: z.array(z.object({ month: z.string(), edits: z.number().int() })),
  churn: z.record(z.string(), z.number().int()),
  hasVectors: z.boolean(),
});

export const articleSchema = z.object({
  pageId: z.number().int(),
  title: z.string(),
  revisions: z.number().int(),
  firstTs: z.number(),
  lastTs: z.number(),
  tier: z.number().int(),
  reviewed: z.boolean(),
  questions: z.array(z.object({ fi: z.string(), en: z.string() })),
});

export const coverageSchema = z.object({
  articles: z.number().int(),
  revisions: z.number().int(),
  paragraphVersions: z.number().int(),
  wordings: z.number().int(),
  vectors: z.number().int(),
  databaseBytes: z.number(),
  mariadbVersion: z.string(),
  corpusEnd: z.number(),
});

export type FrameBlock = z.infer<typeof frameBlockSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Match = z.infer<typeof matchSchema>;
export type AskResult = z.infer<typeof askResultSchema>;
export type Wording = z.infer<typeof wordingSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type Article = z.infer<typeof articleSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
