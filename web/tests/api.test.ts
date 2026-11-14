import { describe, expect, it } from 'vitest';

import { ApiError, createApi } from '../src/api';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

const okBody = (data: unknown): string => JSON.stringify({ success: true, data, error: null, meta: null });
const json = (data: unknown, status = 200): Response => new Response(okBody(data), { status });
const failure = (message: string, status: number): Response =>
  new Response(JSON.stringify({ success: false, data: null, error: message, meta: null }), { status });

const article = {
  pageId: 1, title: 'Testisota', revisions: 10, firstTs: 1, lastTs: 2, tier: 1, reviewed: false, questions: [],
};
const frame = { t: 123, blocks: [{ paraId: 2, hash: 'ab', revId: 102 }], sql: 'SELECT 1', dbMs: 0.4 };

describe('api client', () => {
  it('unwraps the data of a successful envelope', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json([article]));
    await expect(createApi(fetchImpl).articles()).resolves.toEqual([article]);
    expect(calls[0]?.url).toBe('/api/articles');
  });

  it('throws ApiError with the status and the message of a failed envelope', async () => {
    const { fetchImpl } = fakeFetch(() => failure('database unavailable', 503));
    const error = await createApi(fetchImpl).articles().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).message).toBe('database unavailable');
  });

  it('throws ApiError when the body is not JSON', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>oops</html>', { status: 502 }));
    const error = await createApi(fetchImpl).articles().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
  });

  it('throws ApiError when the data has an unexpected shape', async () => {
    const { fetchImpl } = fakeFetch(() => json([{ pageId: 'one' }]));
    await expect(createApi(fetchImpl).articles()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError with status 0 when the server cannot be reached', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const error = await createApi(fetchImpl).articles().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it('requests a frame by time and passes the abort signal through', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(frame));
    const controller = new AbortController();
    await expect(createApi(fetchImpl).frame(1, 123, controller.signal)).resolves.toEqual(frame);
    expect(calls[0]?.url).toBe('/api/articles/1/at?t=123');
    expect(calls[0]?.init?.signal?.aborted).toBe(false);
    controller.abort();
    expect(calls[0]?.init?.signal?.aborted).toBe(true);        // the caller's abort reaches the request
  });

  it('lets an abort surface as an abort, not as a server error', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    const error = await createApi(fetchImpl).frame(1, 123).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('asks nothing of the server for an empty list of wordings', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({}));
    await expect(createApi(fetchImpl).wordings([])).resolves.toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('fetches wordings in requests of at most 200 hashes and merges them', async () => {
    const hashes = Array.from({ length: 450 }, (_, i) => i.toString(16).padStart(32, '0'));
    const { fetchImpl, calls } = fakeFetch((url) => {
      const asked = new URL(url, 'http://x').searchParams.get('hashes')?.split(',') ?? [];
      return json(Object.fromEntries(asked.map((hash) => [hash, { kind: 'p', text: hash }])));
    });
    const found = await createApi(fetchImpl).wordings(hashes);
    expect(calls).toHaveLength(3);
    expect(Object.keys(found)).toHaveLength(450);
  });

  it('posts the question as JSON', async () => {
    const result = { mode: 'vector', matches: [], timeline: [], embedMs: 1, rankMs: 2, sql: 'SELECT' };
    const { fetchImpl, calls } = fakeFetch(() => json(result));
    await expect(createApi(fetchImpl).ask(7, 'Miksi?')).resolves.toEqual(result);
    expect(calls[0]?.url).toBe('/api/articles/7/ask');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ question: 'Miksi?' });
  });

  it('reads the overview, a paragraph timeline and the coverage', async () => {
    const overview = {
      pageId: 1, title: 'T', firstTs: 1, lastTs: 2, corpusEnd: 3, bars: [{ month: '2010-03', edits: 1 }],
      churn: { '2': 4 }, hasVectors: true,
    };
    const coverage = {
      articles: 1, revisions: 10, paragraphVersions: 12, wordings: 9, vectors: 8, databaseBytes: 100,
      mariadbVersion: '12.3.3', corpusEnd: 3,
    };
    const { fetchImpl, calls } = fakeFetch((url) =>
      url.endsWith('/overview') ? json(overview) : url.endsWith('/timeline') ? json([]) : json(coverage));
    const api = createApi(fetchImpl);
    await expect(api.overview(1)).resolves.toEqual(overview);
    await expect(api.paragraphTimeline(1, 2)).resolves.toEqual([]);
    await expect(api.coverage()).resolves.toEqual(coverage);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/articles/1/overview', '/api/articles/1/paragraphs/2/timeline', '/api/coverage',
    ]);
  });
});

describe('all wordings of an article', () => {
  it('fetches every wording of an article in one request', async () => {
    const wordings = { aa: { kind: 'p', text: 'yksi' }, bb: { kind: 'h', text: 'Tausta' } };
    const { fetchImpl, calls } = fakeFetch(() => json(wordings));
    await expect(createApi(fetchImpl).articleWordings(7)).resolves.toEqual(wordings);
    expect(calls.map((call) => call.url)).toEqual(['/api/articles/7/wordings']);
  });
});

describe('a server that does not answer', () => {
  const hangs = (_url: string, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });

  it('gives up after the time limit with a plain error', async () => {
    const error = await createApi(hangs, { timeoutMs: 20 }).articles().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toContain('did not answer');
  });

  it('still reports the caller\'s own abort as an abort', async () => {
    const controller = new AbortController();
    const pending = createApi(hangs, { timeoutMs: 5000 }).frame(1, 123, controller.signal).catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe('AbortError');
  });
});
