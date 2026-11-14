// The typed client for the Python API. Every answer is checked against its schema, because
// what arrives over the network is not trusted to have the shape the page expects.
import { z } from 'zod';

import {
  articleSchema,
  askResultSchema,
  coverageSchema,
  frameSchema,
  overviewSchema,
  segmentSchema,
  wordingsSchema,
} from './types';
import type { Article, AskResult, Coverage, Frame, Overview, Segment, Wording } from './types';

export const MAX_HASHES_PER_REQUEST = 200;

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  error: z.string().nullable(),
});

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Api {
  articles(): Promise<Article[]>;
  overview(pageId: number): Promise<Overview>;
  frame(pageId: number, t: number, signal?: AbortSignal): Promise<Frame>;
  wordings(hashes: readonly string[]): Promise<Record<string, Wording>>;
  /** Every wording an article ever had, in one request. */
  articleWordings(pageId: number): Promise<Record<string, Wording>>;
  ask(pageId: number, question: string): Promise<AskResult>;
  paragraphTimeline(pageId: number, paraId: number): Promise<Segment[]>;
  coverage(): Promise<Coverage>;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createApi(fetchImpl: FetchLike = (url, init) => fetch(url, init)): Api {
  async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error: unknown) {
      if (isAbort(error)) throw error;
      throw new ApiError('cannot reach the server', 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError('the server sent an unreadable answer', response.status);
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) throw new ApiError('the server sent an unexpected answer', response.status);
    if (!envelope.data.success) throw new ApiError(envelope.data.error ?? 'the request failed', response.status);
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) throw new ApiError('the server sent an unexpected answer', response.status);
    return data.data;
  }

  return {
    articles: () => request('/api/articles', z.array(articleSchema)),
    overview: (pageId) => request(`/api/articles/${pageId}/overview`, overviewSchema),
    frame: (pageId, t, signal) => request(`/api/articles/${pageId}/at?t=${t}`, frameSchema, { signal }),
    wordings: async (hashes) => {
      const merged: Record<string, Wording> = {};
      for (let start = 0; start < hashes.length; start += MAX_HASHES_PER_REQUEST) {
        const chunk = hashes.slice(start, start + MAX_HASHES_PER_REQUEST);
        Object.assign(merged, await request(`/api/wordings?hashes=${chunk.join(',')}`, wordingsSchema));
      }
      return merged;
    },
    articleWordings: (pageId) => request(`/api/articles/${pageId}/wordings`, wordingsSchema),
    ask: (pageId, question) =>
      request(`/api/articles/${pageId}/ask`, askResultSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      }),
    paragraphTimeline: (pageId, paraId) =>
      request(`/api/articles/${pageId}/paragraphs/${paraId}/timeline`, z.array(segmentSchema)),
    coverage: () => request('/api/coverage', coverageSchema),
  };
}
