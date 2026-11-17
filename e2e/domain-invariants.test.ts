import { describe, expect, it } from 'vitest';
import { createDemoHandover, DEMO_TRANSCRIPTS } from '../src/domain/fixtures';
import {
  compareHandover,
  confirmItem,
  recordReadback,
  releaseItem,
  restoreHandover,
  submitReadback,
} from '../src/domain/engine';
import { parseTranscript } from '../src/domain/parser';
import type { HandoverState, Language } from '../src/domain/types';

function parse(
  state: HandoverState,
  text: string,
  language: Language = 'en-IN',
  scopeItemIds?: string[],
) {
  return parseTranscript({ text, items: state.items, role: 'incoming', language, scopeItemIds });
}

function agreedState() {
  return submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
}

describe('independent adversarial handover review', () => {
  it.each(['en-IN', 'hi-IN', 'mr-IN'] as const)(
    'accepts the explicitly supported corrected and paraphrased examples (%s)',
    (language) => {
      for (const text of [
        DEMO_TRANSCRIPTS[language].corrected,
        DEMO_TRANSCRIPTS[language].harmless,
      ]) {
        const state = submitReadback(createDemoHandover(language), text, { language });
        expect(compareHandover(state).map((item) => item.status)).toEqual([
          'agreement',
          'agreement',
          'agreement',
        ]);
      }
    },
  );

  it('does not split a shared action away from explicitly enumerated item IDs', () => {
    const state = createDemoHandover();
    const result = parse(
      state,
      'I will hold two parcels J1 and J2 until the address is confirmed.',
    );
    for (const id of ['J1', 'J2']) {
      const claims = result.claims.filter((claim) => claim.itemIds.includes(id));
      expect(claims.length).toBeGreaterThan(0);
      expect(
        claims.some((claim) => claim.action === 'hold' && claim.condition === 'address confirmed'),
      ).toBe(true);
      expect(result.issues.filter((issue) => issue.itemIds.includes(id))).toEqual([]);
    }
  });

  it.each([
    ['en-IN', 'I will not send eight Nagpur parcels after 3 pm.'],
    ['hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजना नहीं चाहता।'],
    ['mr-IN', 'मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवणार नाही.'],
  ] as const)(
    'does not turn an unsupported negative intent into agreement (%s)',
    (language, text) => {
      const state = submitReadback(createDemoHandover(language), text, { language });
      expect(compareHandover(state).find((item) => item.itemId === 'NAGPUR')?.status).not.toBe(
        'agreement',
      );
      expect(() => confirmItem(state, 'NAGPUR')).toThrow();
    },
  );

  it('does not normalise an explicitly negative prerequisite into the positive requirement', () => {
    const state = submitReadback(
      createDemoHandover(),
      'I will hold one parcel J1 until the address is not confirmed.',
    );
    expect(compareHandover(state).find((item) => item.itemId === 'J1')?.status).not.toBe(
      'agreement',
    );
    expect(() => confirmItem(state, 'J1')).toThrow();
  });

  it('does not reinterpret all parcels as only the selected clarification item', () => {
    const state = createDemoHandover();
    const result = parse(state, 'I will send all parcels.', 'en-IN', ['J1']);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('keeps evidence offsets in the original Unicode transcript', () => {
    const state = createDemoHandover('hi-IN');
    const result = parse(state, DEMO_TRANSCRIPTS['hi-IN'].corrected, 'hi-IN');
    for (const part of [...result.claims, ...result.issues]) {
      expect(part.evidence.utteranceId).toBe(result.utteranceId);
      expect(result.text.slice(part.evidence.start, part.evidence.end)).toBe(part.evidence.text);
    }
  });

  it('rejects a late extraction of J1 after its instruction changes', () => {
    const original = createDemoHandover();
    const pending = parse(original, DEMO_TRANSCRIPTS['en-IN'].corrected);
    const changed = releaseItem(original, 'J1');
    expect(() => recordReadback(changed, pending)).toThrow(/changed|current|stale/i);
    expect(changed.items.find((item) => item.id === 'J1')?.revision).toBe(2);
    expect(changed.items.find((item) => item.id === 'J2')?.action).toBe('hold');
  });

  it('rejects a same-length fabricated source quote', () => {
    const state = createDemoHandover();
    const result = parse(state, DEMO_TRANSCRIPTS['en-IN'].corrected);
    result.claims[0]!.evidence.text = 'x'.repeat(result.claims[0]!.evidence.text.length);
    expect(() => recordReadback(state, result)).toThrow(/quote|original|evidence/i);
  });

  it('keeps the newer instruction when a previously applied utterance is retried', () => {
    const original = createDemoHandover();
    const parsed = parse(original, DEMO_TRANSCRIPTS['en-IN'].corrected);
    const read = recordReadback(original, parsed);
    const changed = releaseItem(read, 'J1');
    const retried = recordReadback(changed, parsed);
    expect(retried).toEqual(changed);
    expect(compareHandover(retried).find((item) => item.itemId === 'J1')?.confirmed).toBe(false);
    expect(retried.events).toHaveLength(changed.events.length);
  });

  it('preserves unaffected confirmation when only J1 is released', () => {
    let state = agreedState();
    for (const id of ['NAGPUR', 'J1', 'J2']) state = confirmItem(state, id);
    const changed = releaseItem(state, 'J1');
    const comparisons = Object.fromEntries(
      compareHandover(changed).map((item) => [item.itemId, item]),
    );
    expect(comparisons.J1.confirmed).toBe(false);
    expect(comparisons.J1.stale).toBe(true);
    expect(comparisons.J2.confirmed).toBe(true);
    expect(comparisons.NAGPUR.confirmed).toBe(true);
    expect(() => confirmItem(changed, 'J1')).toThrow();
  });

  it('rejects restored confirmation state that points at an unrelated source utterance', () => {
    const confirmed = confirmItem(agreedState(), 'J1');
    confirmed.confirmations.J1.utteranceId = 'nonexistent-recording';
    expect(() => restoreHandover(confirmed)).toThrow(/invalid|stale|supported|inconsistent/i);
  });

  it('rejects duplicate item identities in imported state', () => {
    const state = createDemoHandover();
    state.items.push(structuredClone(state.items[0]!));
    expect(() => restoreHandover(state)).toThrow(/duplicate|supported/i);
  });

  it('treats completed dispatch as a clarification, not a future-action agreement', () => {
    const state = submitReadback(
      createDemoHandover(),
      'I already sent eight Nagpur parcels after 3 pm.',
    );
    expect(compareHandover(state).find((item) => item.itemId === 'NAGPUR')?.status).not.toBe(
      'agreement',
    );
  });
});
