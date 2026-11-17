import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { extractionRequestSchema, extractWithModel, modelConfiguration } from './model.ts';

const MAX_BODY = 64 * 1024;
const budget = { resetAt: 0, count: 0, running: 0 };
function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}
function authorized(header: string | undefined, token: string): boolean {
  const supplied = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
    throw new Error('content-type');
  const supplied = (req as IncomingMessage & { body?: unknown }).body;
  if (supplied !== undefined) {
    const raw = typeof supplied === 'string' ? supplied : JSON.stringify(supplied);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('large');
    return JSON.parse(raw);
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > MAX_BODY) throw new Error('large');
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = (req.url ?? '/').split('?')[0];
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/status' || path === '/api/health') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      json(res, 405, { error: 'Use GET.' });
      return true;
    }
    const config = modelConfiguration();
    json(res, 200, {
      ok: true,
      modelConfigured: !!config,
      modelName: config?.model ?? null,
      requiresToken: !!config,
      localRulesAvailable: true,
    });
    return true;
  }
  if (path !== '/api/analyze') {
    json(res, 404, { error: 'API route not found.' });
    return true;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'Use POST.' });
    return true;
  }
  const config = modelConfiguration();
  if (!config) {
    json(res, 503, { error: 'Model extraction is not configured. Local rules remain available.' });
    return true;
  }
  if (!authorized(req.headers.authorization, config.accessToken)) {
    json(res, 401, { error: 'Enter the model access token for this workspace.' });
    return true;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        json(res, 403, { error: 'Cross-origin requests are not accepted.' });
        return true;
      }
    } catch {
      json(res, 403, { error: 'Invalid request origin.' });
      return true;
    }
  }
  if (Date.now() >= budget.resetAt) {
    budget.resetAt = Date.now() + 60_000;
    budget.count = 0;
  }
  if (budget.count >= 20 || budget.running >= 2) {
    res.setHeader('Retry-After', '60');
    json(res, 429, { error: 'The model service is busy. Try again in a minute.' });
    return true;
  }
  let input;
  try {
    input = extractionRequestSchema.parse(await readBody(req));
  } catch {
    json(res, 400, {
      error:
        'Provide a valid transcript and current item catalogue (maximum 6,000 characters and 50 items).',
    });
    return true;
  }
  // Body reads yield; recheck and reserve synchronously so concurrent uploads cannot race the budget.
  if (Date.now() >= budget.resetAt) {
    budget.resetAt = Date.now() + 60_000;
    budget.count = 0;
  }
  if (budget.count >= 20 || budget.running >= 2) {
    res.setHeader('Retry-After', '60');
    json(res, 429, { error: 'The model service is busy. Try again in a minute.' });
    return true;
  }
  budget.count++;
  budget.running++;
  try {
    json(res, 200, await extractWithModel(input, config));
  } catch {
    json(res, 502, {
      error:
        'The model interpretation could not be verified. Your draft is unchanged. Try a clearer statement or explicitly switch to local rules.',
    });
  } finally {
    budget.running--;
  }
  return true;
}
