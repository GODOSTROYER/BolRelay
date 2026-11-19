import { describe, expect, it } from 'vitest';
import { createReviewedHandover, draftInstructions } from '../../src/domain/draft';
import { restoreHandover } from '../../src/domain/engine';
import { importHandover, serializeHandoverExport } from '../../src/lib/export';
import type { ItemInput, Language } from '../../src/domain/types';

const freshExamples = [
  {
    language: 'en-IN',
    text: 'Send five Pune parcels after 9 AM. Hold three Mehta parcels until the address is confirmed.',
    labels: ['Pune', 'Mehta'],
  },
  {
    language: 'hi-IN',
    text: 'पाँच पुणे पार्सल सुबह नौ बजे के बाद भेजना। तीन मेहता पार्सल पता कन्फर्म होने तक रोक कर रखना।',
    labels: ['पुणे', 'मेहता'],
  },
  {
    language: 'mr-IN',
    text: 'पाच पुणे पार्सल सकाळी नऊ नंतर पाठवा. पत्त्याची पुष्टी होईपर्यंत तीन मेहता पार्सल थांबवा.',
    labels: ['पुणे', 'मेहता'],
  },
] satisfies { language: Language; text: string; labels: string[] }[];

describe('fresh spoken handover creation', () => {
  it.each(freshExamples)(
    'creates and round-trips fresh $language instructions with exact source evidence',
    async ({ language, text, labels }) => {
      const draft = draftInstructions(text, language);
      expect(draft.problems).toEqual([]);
      expect(draft.items.map((item) => item.label)).toEqual(labels);
      expect(draft.items.map((item) => item.quantity)).toEqual([5, 3]);
      expect(draft.items.map((item) => item.action)).toEqual(['dispatch', 'hold']);
      expect(draft.items.map((item) => item.notBefore)).toEqual(['09:00', null]);
      expect(draft.items.map((item) => item.condition)).toEqual([null, 'address confirmed']);
      const state = createReviewedHandover(draft, {
        title: 'Morning packing desk',
        outgoingName: 'Mira',
        incomingName: 'Isha',
      });
      expect(state.participantLanguages).toEqual({ outgoing: language, incoming: language });
      expect(state.utterances).toHaveLength(1);
      expect(state.utterances[0]!.text).toBe(text);
      for (const item of state.items) {
        expect(item.evidenceFields).toEqual(
          expect.arrayContaining(['object', 'quantity', 'unit', 'action']),
        );
        for (const evidence of item.evidence) {
          expect(evidence.utteranceId).toBe(state.utterances[0]!.utteranceId);
          expect(text.slice(evidence.start, evidence.end)).toBe(evidence.text);
        }
      }
      expect(restoreHandover(JSON.parse(JSON.stringify(state)))).toEqual(state);
      expect(
        await importHandover(new File([serializeHandoverExport(state)], 'morning.json')),
      ).toEqual(state);
    },
  );

  it('preserves separately stated physical IDs instead of inventing allocation across a group', () => {
    const draft = draftInstructions(
      'Send one parcel P7. Hold one parcel P8 until the address is confirmed.',
      'en-IN',
    );
    expect(draft.problems).toEqual([]);
    expect(draft.items.map((item) => [item.id, item.quantity, item.action])).toEqual([
      ['P7', 1, 'dispatch'],
      ['P8', 1, 'hold'],
    ]);
    expect(() => createReviewedHandover(draft, {})).not.toThrow();
  });

  it.each([
    ['quantity', { quantity: 999 }],
    ['unit', { unit: 'carton' }],
    ['action', { action: 'hold' }],
    ['time', { notBefore: '10:00' }],
    ['unstated owner', { owner: 'Ravi' }],
    ['unstated prerequisite', { condition: 'payment received' }],
    ['identity label', { label: 'Mumbai' }],
  ] satisfies [string, Partial<ItemInput>][])(
    'rejects a changed %s that was not the reviewed source-derived proposal',
    (_name, patch) => {
      const draft = draftInstructions(freshExamples[0]!.text, 'en-IN');
      Object.assign(draft.items[0]!, patch);
      expect(() => createReviewedHandover(draft, {})).toThrow();
    },
  );

  it.each([
    '',
    'Send five Pune parcels after nine.',
    'Send five parcels after 9 AM.',
    'Send Pune parcels after 9 AM.',
    'Hold three Mehta parcels.',
    'Send zero Pune parcels.',
    // "twenty one" is now composed to 21 (see p0-compound-numbers.test.ts);
    // number wording that is not composed must still block creation.
    'Send fourty one Pune parcels.',
    'Send thirty-first Pune parcels.',
    'Send one hundred Pune parcels.',
    'Send five dozen Pune parcels.',
    'Send 2.5 Pune boxes.',
    'After 3 PM send Pune parcels.',
    'Send two parcels to Pune and Mumbai.',
    'Pack five blue boxes and red ones.',
    'Send two Pune parcels except Mumbai.',
    'Send two parcels J1 J2.',
    'Send five Pune parcels. Hold two Pune parcels until the address is confirmed.',
    'Send five Pune parcels. Hold two pune parcels until the address is confirmed.',
    'Send one red J1 parcel. Hold one blue J1 parcel until the address is confirmed.',
    'Send five Pune parcels after 9 AM. Hold three parcels until the address is confirmed.',
    Array.from({ length: 13 }, (_, i) => `Pack one parcel P${i + 1}.`).join(' '),
    `Send five Pune parcels. ${'extra '.repeat(800)}`,
  ])('blocks incomplete, ambiguous or unsupported creation: %s', (text) => {
    const draft = draftInstructions(text, 'en-IN');
    expect(draft.problems.length).toBeGreaterThan(0);
    expect(() => createReviewedHandover(draft, {})).toThrow();
  });

  it('never promotes the usable half of a draft whose other instruction remains unresolved', () => {
    const draft = draftInstructions(
      'Send five Pune parcels after 9 AM. Hold three Mehta parcels.',
      'en-IN',
    );
    expect(draft.items.length).toBeGreaterThan(0);
    expect(draft.problems.some((problem) => problem.code === 'hold')).toBe(true);
    expect(() => createReviewedHandover(draft, {})).toThrow(/resolve|draft/i);
  });
});
