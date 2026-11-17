import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../server/http';
import * as model from '../server/model';
import { createDemoHandover } from '../src/domain/fixtures';
import { parseTranscript } from '../src/domain/parser';

function responseRecorder() {
  const headers = new Map<string, string>();
  const captured = { status: 200, ended: false, body: '' };
  const response = {
    set statusCode(value: number) {
      captured.status = value;
    },
    get statusCode() {
      return captured.status;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(body?: string) {
      captured.body = body ?? '';
      captured.ended = true;
    },
  } as unknown as ServerResponse;
  return { response, captured, headers };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('asynchronous request budget', () => {
  it('reserves only two provider slots when multiple request bodies finish together', async () => {
    vi.stubEnv('BOLRELAY_MODEL_URL', 'https://example.invalid/v1/chat/completions');
    vi.stubEnv('BOLRELAY_MODEL', 'synthetic-test-model');
    vi.stubEnv('BOLRELAY_ACCESS_TOKEN', 'synthetic-only-token-at-least-24-characters');

    const input = {
      text: 'I will send eight Nagpur parcels after 3 pm.',
      role: 'incoming' as const,
      language: 'en-IN' as const,
      utteranceId: 'synthetic-budget-test',
      items: createDemoHandover().items,
    };
    const parsed = parseTranscript(input);
    let releaseBodies!: () => void;
    const bodies = new Promise<void>((resolve) => {
      releaseBodies = resolve;
    });
    let releaseProvider!: () => void;
    const provider = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const forwarded = vi.spyOn(model, 'extractWithModel').mockImplementation(async () => {
      await provider;
      return { ...parsed, parser: 'model' };
    });

    function request(): IncomingMessage {
      const stream = Readable.from(
        (async function* () {
          await bodies;
          yield JSON.stringify(input);
        })(),
      );
      return Object.assign(stream, {
        url: '/api/analyze',
        method: 'POST',
        headers: {
          host: '127.0.0.1',
          'content-type': 'application/json',
          authorization: 'Bearer synthetic-only-token-at-least-24-characters',
        },
      }) as unknown as IncomingMessage;
    }

    const responses = Array.from({ length: 6 }, responseRecorder);
    const jobs = responses.map((result) => handleApi(request(), result.response));
    try {
      // Each handler enters readBody before any body can finish.
      releaseBodies();
      await vi.waitFor(() => {
        expect(forwarded).toHaveBeenCalledTimes(2);
        expect(responses.filter((result) => result.captured.ended)).toHaveLength(4);
      });
      const rejected = responses.filter((result) => result.captured.ended);
      expect(rejected.map((result) => result.captured.status)).toEqual([429, 429, 429, 429]);
      expect(rejected.every((result) => result.headers.get('retry-after') === '60')).toBe(true);
    } finally {
      releaseProvider();
      await Promise.all(jobs);
    }
    expect(responses.filter((result) => result.captured.status === 200)).toHaveLength(2);
    expect(forwarded).toHaveBeenCalledTimes(2);

    // Completion releases the concurrency reservation; the next request may run.
    const next = responseRecorder();
    await handleApi(request(), next.response);
    expect(next.captured.status).toBe(200);
    expect(forwarded).toHaveBeenCalledTimes(3);
  });
});
