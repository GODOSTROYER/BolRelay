import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handleApi } from '../../server/http';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    void handleApi(req, res)
      .then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      })
      .catch(() => {
        res.statusCode = 500;
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  vi.unstubAllEnvs();
  for (const key of [
    'BOLRELAY_MODEL_URL',
    'BOLRELAY_MODEL',
    'BOLRELAY_MODEL_API_KEY',
    'BOLRELAY_ACCESS_TOKEN',
  ])
    vi.stubEnv(key, '');
});

function configure() {
  vi.stubEnv('BOLRELAY_MODEL_URL', 'https://example.com/v1/chat/completions');
  vi.stubEnv('BOLRELAY_MODEL', 'test-model');
  vi.stubEnv('BOLRELAY_ACCESS_TOKEN', 'test-only-token-with-24-characters');
}

describe('API policy and input guards', () => {
  it('reports a functional local mode with model extraction explicitly disabled', async () => {
    const response = await fetch(`${base}/api/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      modelConfigured: false,
      modelName: null,
      localRulesAvailable: true,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns unavailable for model requests without an explicitly configured provider', async () => {
    const response = await fetch(`${base}/api/analyze`, { method: 'POST' });
    expect(response.status).toBe(503);
  });
  it('requires a bearer token before parsing or forwarding model requests', async () => {
    configure();
    const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: 'malformed' });
    expect(response.status).toBe(401);
  });
  it('rejects cross-origin use even with a valid access token', async () => {
    configure();
    const response = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-only-token-with-24-characters',
        origin: 'https://another-site.invalid',
      },
    });
    expect(response.status).toBe(403);
  });
  it('rejects malformed and oversized bodies before making a provider call', async () => {
    configure();
    for (const body of ['{', JSON.stringify({ text: 'x'.repeat(70_000) })]) {
      const response = await fetch(`${base}/api/analyze`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-only-token-with-24-characters',
          'content-type': 'application/json',
        },
        body,
      });
      expect(response.status).toBe(400);
    }
  });
  it('has explicit method and route handling', async () => {
    expect((await fetch(`${base}/api/analyze`)).status).toBe(405);
    expect((await fetch(`${base}/api/status`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/api/no-such-route`)).status).toBe(404);
  });
});
