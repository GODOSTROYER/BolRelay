import { parseTranscript } from '../domain/parser';
import { parsedTranscriptSchema } from '../domain/schema';
import type { ParseTranscriptInput, ParsedTranscript } from '../domain/types';

export interface Capabilities {
  modelConfigured: boolean;
  modelName: string | null;
  requiresToken: boolean;
}
export async function getCapabilities(): Promise<Capabilities> {
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error('Unavailable');
    const body = await response.json();
    return {
      modelConfigured: body.modelConfigured === true,
      modelName: typeof body.modelName === 'string' ? body.modelName : null,
      requiresToken: body.requiresToken === true,
    };
  } catch {
    return { modelConfigured: false, modelName: null, requiresToken: false };
  }
}

export async function analyzeTranscript(
  input: ParseTranscriptInput,
  options: { mode: 'local' | 'model'; accessToken?: string; signal?: AbortSignal } = {
    mode: 'local',
  },
): Promise<ParsedTranscript> {
  if (options.signal?.aborted) throw new Error('The request was canceled.');
  if (options.mode === 'local') return parseTranscript(input);
  const request = { ...input, utteranceId: input.utteranceId ?? crypto.randomUUID() };
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error('The model service could not be reached. Your draft is unchanged.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : 'Model extraction failed. Your draft is unchanged.',
    );
  const parsed = parsedTranscriptSchema.parse(body);
  if (
    parsed.utteranceId !== request.utteranceId ||
    parsed.text !== request.text ||
    parsed.role !== request.role
  )
    throw new Error('The model response does not match this recording.');
  for (const item of request.items)
    if (parsed.itemRevisions[item.id] !== item.revision)
      throw new Error('The model response refers to an older plan.');
  return parsed;
}
