import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  confirmItem,
  createDemoHandover,
  parseTranscript,
  releaseItem,
  submitReadback,
} from '../../src/domain';
import { normalizeNumbers } from '../../src/domain/parser';
import type { HandoverState } from '../../src/domain';

const comparison = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!;

describe('independent interpretation regressions', () => {
  it.each([
    'I will hold two Joshi parcels until the address is confirmed and release them now.',
    'I will hold two Joshi parcels until the address is confirmed or send them immediately.',
    'I will hold two Joshi parcels until the address is confirmed and immediately dispatch them.',
    'I will hold two Joshi parcels until the address is confirmed, or ship them today.',
    'I will hold two Joshi parcels until the address is confirmed but give them to the driver.',
    'I will hold two Joshi parcels until the address is confirmed and hand them to the driver.',
  ])('never confirms a competing release commitment: %s', (text) => {
    const state = submitReadback(createDemoHandover(), text);
    for (const id of ['J1', 'J2']) {
      expect(comparison(state, id).status).not.toBe('agreement');
      expect(() => confirmItem(state, id)).toThrow();
    }
  });

  it.each([
    'I will hold two Joshi parcels until the address is confirmed, then release them.',
    'I will hold two Joshi parcels until the address is confirmed and then dispatch the parcels.',
  ])('preserves an explicit conditional sequence: %s', (text) => {
    const state = submitReadback(createDemoHandover(), text);
    expect(comparison(state, 'J1').status).toBe('agreement');
    expect(comparison(state, 'J2').status).toBe('agreement');
  });

  it.each([
    'I will send eight Nagpur parcels after three in the morning.',
    'मैं सुबह तीन बजे के बाद आठ नागपुर पार्सल भेजूंगा।',
    'मी सकाळी तीन वाजल्यानंतर आठ नागपूर पार्सल पाठवेन.',
    'I will send eight Nagpur parcels after 03:00.',
    'I will send eight Nagpur parcels after 3 a.m.',
  ])('keeps morning distinct from the expected afternoon: %s', (text) => {
    const state = submitReadback(createDemoHandover(), text);
    expect(state.utterances.at(-1)!.claims[0]!.notBefore).toBe('03:00');
    expect(comparison(state, 'NAGPUR').status).toBe('contradiction');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });

  it.each(['three', '3:00', '3 PM in the morning'])(
    'asks about an unresolved day period: %s',
    (time) => {
      const state = submitReadback(
        createDemoHandover(),
        `I will send eight Nagpur parcels after ${time}.`,
      );
      expect(comparison(state, 'NAGPUR').status).toBe('uncertainty');
      expect(() => confirmItem(state, 'NAGPUR')).toThrow();
    },
  );

  it.each(['three in the afternoon', 'three in the evening', '3 p.m.', '15:00'])(
    'accepts an explicit afternoon time: %s',
    (time) => {
      const state = submitReadback(
        createDemoHandover(),
        `I will send eight Nagpur parcels after ${time}.`,
      );
      expect(comparison(state, 'NAGPUR').status).toBe('agreement');
    },
  );

  it('extracts the same facts when the expected time, quantity or action changes', () => {
    const items = createDemoHandover().items;
    const text = 'Send eight Nagpur parcels after three in the morning.';
    const first = parseTranscript({
      text,
      role: 'incoming',
      language: 'en-IN',
      items,
      utteranceId: 'same',
    });
    const changed = items.map((item) => ({
      ...item,
      notBefore: '03:00',
      quantity: 99,
      action: 'collect' as const,
    }));
    const second = parseTranscript({
      text,
      role: 'incoming',
      language: 'en-IN',
      items: changed,
      utteranceId: 'same',
    });
    expect(second.claims).toEqual(first.claims);
    expect(second.issues).toEqual(first.issues);
  });

  it.each(['J3', 'Q-9', 'Gupta', 'Müller'])(
    'cannot silently rename %s to the selected J1',
    (identity) => {
      const initial = releaseItem(createDemoHandover(), 'J1');
      const state = submitReadback(initial, `I will send one parcel ${identity}.`, {
        scopeItemIds: ['J1'],
      });
      expect(comparison(state, 'J1').status).not.toBe('agreement');
      expect(() => confirmItem(state, 'J1')).toThrow();
    },
  );

  it('rejects an unknown ID even alongside a known ID', () => {
    const state = submitReadback(
      createDemoHandover(),
      'Hold two parcels J1 and J3 until the address is confirmed.',
    );
    expect(comparison(state, 'J1').status).not.toBe('agreement');
    expect(
      state.utterances.at(-1)!.issues.some((issue) => issue.code === 'UNKNOWN_OBJECT_IDENTIFIER'),
    ).toBe(true);
  });

  it('allows a genuinely implicit short answer within one selected item', () => {
    const state = submitReadback(
      createDemoHandover(),
      'I will hold one parcel until the address is confirmed.',
      { scopeItemIds: ['J1'] },
    );
    expect(comparison(state, 'J1').status).toBe('agreement');
    expect(state.utterances.at(-1)!.readbackMode).toBe('targeted');
    expect(state.utterances.at(-1)!.scopeItemIds).toEqual(['J1']);
  });

  it('does not equate checking an address with confirming it', () => {
    const state = submitReadback(
      createDemoHandover(),
      'I will hold two Joshi parcels until the address is checked.',
    );
    expect(state.utterances.at(-1)!.claims[0]!.condition).toBe('address checked');
    expect(comparison(state, 'J1').status).not.toBe('agreement');
    expect(() => confirmItem(state, 'J1')).toThrow();
  });

  it('exports number normalisation without modifying source evidence', () => {
    expect(normalizeNumbers('आठ पार्सल, TWO boxes, १२ नग')).toBe('8 पार्सल, 2 boxes, 12 नग');
    const text = 'I will send eight Nagpur parcels after three in the morning.';
    const parsed = parseTranscript({
      text,
      role: 'incoming',
      language: 'en-IN',
      items: createDemoHandover().items,
    });
    const evidence = parsed.claims[0]!.evidence;
    expect(text.slice(evidence.start, evidence.end)).toBe(evidence.text);
    expect(evidence.text).toContain('eight');
  });

  it.each(['minus eight', 'negative eight', '-8', '−8', 'माइनस आठ', 'उणे आठ'])(
    'never turns a negative amount into a positive match: %s',
    (amount) => {
      const state = submitReadback(
        createDemoHandover(),
        `Send ${amount} Nagpur parcels after 3 PM.`,
      );
      expect(comparison(state, 'NAGPUR').status).toBe('uncertainty');
      expect(() => confirmItem(state, 'NAGPUR')).toThrow();
      expect(
        state.utterances.at(-1)!.issues.some((issue) => issue.code === 'NEGATIVE_QUANTITY'),
      ).toBe(true);
    },
  );

  it.each([
    'about eight',
    'roughly eight',
    'around eight',
    'approximately eight',
    'at least eight',
    'लगभग आठ',
    'करीब आठ',
    'साधारण आठ',
  ])('does not turn a qualified amount into an exact count: %s', (amount) => {
    const state = submitReadback(createDemoHandover(), `Send ${amount} Nagpur parcels after 3 PM.`);
    expect(comparison(state, 'NAGPUR').status).toBe('uncertainty');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });

  it.each(['eight hundred', 'eight dozen', 'eight thousand'])(
    'does not discard an unsupported quantity multiplier: %s',
    (amount) => {
      const state = submitReadback(
        createDemoHandover(),
        `Send ${amount} Nagpur parcels after 3 PM.`,
      );
      expect(comparison(state, 'NAGPUR').status).toBe('uncertainty');
      expect(() => confirmItem(state, 'NAGPUR')).toThrow();
    },
  );
});
