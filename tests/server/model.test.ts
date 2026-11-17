import { describe, expect, it, vi } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import {
  extractionRequestSchema,
  extractWithModel,
  modelConfiguration,
  validateModelOutput,
} from '../../server/model';

const text = 'I will send eight Nagpur parcels after 3 PM.';
const input = () => ({
  text,
  role: 'incoming' as const,
  language: 'en-IN' as const,
  utteranceId: 'recording-001',
  items: createDemoHandover().items,
});
const output = () => ({
  claims: [
    {
      itemIds: ['NAGPUR'],
      action: 'dispatch',
      quantity: 8,
      unit: 'parcel',
      notBefore: '15:00',
      uncertainFields: [],
      evidenceQuote: text,
    },
  ],
  issues: [],
  limitations: [],
});

describe('model configuration boundary', () => {
  it('requires explicit endpoint, model and access token; does not auto-use unrelated credentials', () => {
    expect(modelConfiguration({ OPENAI_API_KEY: 'unrelated' })).toBeNull();
    expect(
      modelConfiguration({
        BOLRELAY_MODEL_URL: 'https://example.com/v1/chat/completions',
        BOLRELAY_MODEL: 'model',
      }),
    ).toBeNull();
  });
  it('rejects insecure nonlocal endpoints and embedded credentials', () => {
    for (const endpoint of [
      'http://example.com/v1/chat/completions',
      'https://user:pass@example.com/v1/chat/completions',
      'https://example.com/v1/chat/completions?key=secret',
    ]) {
      expect(
        modelConfiguration({
          BOLRELAY_MODEL_URL: endpoint,
          BOLRELAY_MODEL: 'chosen',
          BOLRELAY_ACCESS_TOKEN: 'test-token-with-at-least-24-characters',
        }),
      ).toBeNull();
    }
  });
  it('allows an explicit loopback model without a paid-provider key', () => {
    expect(
      modelConfiguration({
        BOLRELAY_MODEL_URL: 'http://127.0.0.1:11434/v1/chat/completions',
        BOLRELAY_MODEL: 'local-model',
        BOLRELAY_ACCESS_TOKEN: 'test-token-with-at-least-24-characters',
      })?.model,
    ).toBe('local-model');
  });
});

describe('model extraction boundary', () => {
  it('computes evidence offsets and revision snapshots from trusted request values', () => {
    const parsed = validateModelOutput(output(), input());
    expect(parsed.parser).toBe('model');
    expect(parsed.claims[0].evidence).toEqual({
      utteranceId: 'recording-001',
      start: 0,
      end: text.length,
      text,
    });
    expect(parsed.itemRevisions).toEqual({ NAGPUR: 1, J1: 1, J2: 1 });
    expect(parsed.claims[0].condition).toBeUndefined();
  });
  it('rejects invented source quotes', () => {
    const body = output();
    body.claims[0].evidenceQuote = 'The address is confirmed.';
    expect(() => validateModelOutput(body, input())).toThrow(/evidence/);
  });
  it('rejects nonunique evidence rather than guessing its location', () => {
    expect(() => validateModelOutput(output(), { ...input(), text: `${text} ${text}` })).toThrow(
      /ambiguous/,
    );
  });
  it('rejects unknown and out-of-scope item references', () => {
    const body = output();
    body.claims[0].itemIds = ['UNKNOWN'];
    expect(() => validateModelOutput(body, input())).toThrow(/unknown/);
    expect(() => validateModelOutput(output(), { ...input(), scopeItemIds: ['J1'] })).toThrow(
      /out-of-scope/,
    );
  });
  it('rejects duplicate item references that could double count a group', () => {
    const body = output();
    body.claims[0].itemIds = ['NAGPUR', 'NAGPUR'];
    expect(() => validateModelOutput(body, input())).toThrow();
  });
  it('does not permit the model to supply confirmations or executable operations', () => {
    expect(() =>
      validateModelOutput({ ...output(), confirmations: { NAGPUR: true } }, input()),
    ).toThrow();
  });
  it('rejects invalid time, negative quantity and empty interpretation', () => {
    const time = output();
    time.claims[0].notBefore = '27:99';
    expect(() => validateModelOutput(time, input())).toThrow();
    const count = output();
    count.claims[0].quantity = -1;
    expect(() => validateModelOutput(count, input())).toThrow();
    expect(() => validateModelOutput({ claims: [], issues: [], limitations: [] }, input())).toThrow(
      /no usable/,
    );
  });
  it('rejects request shape expansion, duplicate catalogue IDs and unknown clarification scope', () => {
    expect(
      extractionRequestSchema.safeParse({ ...input(), endpoint: 'https://evil.invalid' }).success,
    ).toBe(false);
    expect(
      extractionRequestSchema.safeParse({ ...input(), items: [input().items[0], input().items[0]] })
        .success,
    ).toBe(false);
    expect(extractionRequestSchema.safeParse({ ...input(), scopeItemIds: ['NO'] }).success).toBe(
      false,
    );
  });
  it('sends credentials only in server request headers and validates the returned content', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(output()) } }] }),
          { status: 200 },
        ),
      );
    const result = await extractWithModel(
      input(),
      {
        endpoint: 'https://example.com/v1/chat/completions',
        model: 'chosen',
        apiKey: 'test-only-provider-secret',
        accessToken: 'test-only-access-token',
      },
      fetcher,
    );
    expect(result.claims[0].quantity).toBe(8);
    const options = fetcher.mock.calls[0][1]!;
    expect(options.redirect).toBe('error');
    expect(options.body).not.toContain('test-only-provider-secret');
    expect(options.body).not.toContain('test-only-access-token');
    expect((options.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-only-provider-secret',
    );
  });
  it('does not expose provider error bodies to callers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private-provider-debug-details', { status: 403 }));
    await expect(
      extractWithModel(
        input(),
        {
          endpoint: 'https://example.com/v1/chat/completions',
          model: 'chosen',
          accessToken: 'test',
        },
        fetcher,
      ),
    ).rejects.toThrow('The configured model service could not complete this request.');
  });
});
