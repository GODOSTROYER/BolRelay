import { describe, expect, it } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import { parseTranscript } from '../../src/domain/parser';

describe('heavily fragmented transcripts', () => {
  const items = createDemoHandover().items;

  it('are refused as uncertain rather than interpreted clause by clause', () => {
    const text = 'I will send eight Nagpur parcels after 3 PM' + ', a'.repeat(400);
    const parsed = parseTranscript({ text, role: 'incoming', language: 'en-IN', items });
    expect(parsed.claims).toEqual([]);
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['TRANSCRIPT_TOO_FRAGMENTED']);
    expect(parsed.issues[0]!.itemIds).toEqual(items.map((item) => item.id));
  });

  it('leave an ordinary multi-sentence read-back untouched', () => {
    const text =
      'I will send eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';
    const parsed = parseTranscript({ text, role: 'incoming', language: 'en-IN', items });
    expect(parsed.issues.map((issue) => issue.code)).not.toContain('TRANSCRIPT_TOO_FRAGMENTED');
    expect(parsed.claims.length).toBeGreaterThan(0);
  });
});
