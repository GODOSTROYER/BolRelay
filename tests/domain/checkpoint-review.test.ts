import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  confirmItem,
  createDemoHandover,
  parseTranscript,
  restoreHandover,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';

const at = (() => {
  let minute = 0;
  return () => new Date(Date.UTC(2030, 0, 1, 9, minute++)).toISOString();
})();
const status = (state: HandoverState, id: string) =>
  compareHandover(state).find((entry) => entry.itemId === id)!.status;

describe('inflected second- and third-person read-backs are not the speaker’s commitment', () => {
  const items = createDemoHandover().items;
  it.each([
    ['en-IN', 'He sends eight Nagpur parcels after 3 PM.'],
    ['en-IN', 'They are sending eight Nagpur parcels after 3 PM.'],
    ['en-IN', 'She is sending eight Nagpur parcels after 3 PM.'],
    ['en-IN', 'You are holding two Joshi parcels until the address is confirmed.'],
    ['en-IN', 'He holds two Joshi parcels until the address is confirmed.'],
    ['en-IN', 'You send eight Nagpur parcels after 3 PM.'],
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेज देगा।'],
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजे जाएंगे।'],
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेज दीजिए।'],
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजोगे।'],
    ['mr-IN', 'आठ नागपूर पार्सल दुपारी तीन नंतर पाठवायचे.'],
    ['mr-IN', 'आठ नागपूर पार्सल दुपारी तीन नंतर पाठवावीत.'],
    ['mr-IN', 'आठ नागपूर पार्सल दुपारी तीन नंतर पाठवशील.'],
  ] as [Language, string][])(
    '%s "%s" is flagged as addressed to someone else',
    (language, text) => {
      const parsed = parseTranscript({ text, role: 'incoming', language, items });
      expect(parsed.issues.map((issue) => issue.code)).toContain('ADDRESSED_TO_OTHER');
    },
  );

  it.each([
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM.'],
    ['hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'जी आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजेंगे।'],
    ['mr-IN', 'मी आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
  ] as [Language, string][])('%s first-person "%s" still agrees', (language, text) => {
    const state = submitReadback(createDemoHandover(language), text, { at: at() });
    expect(status(state, 'NAGPUR')).toBe('agreement');
  });
});

describe('a full restatement cannot be rebuilt from one-detail answers', () => {
  it('keeps the negated read-back open until the item is restated in one statement', () => {
    let state = submitReadback(
      createDemoHandover(),
      'I will not send eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.',
      { at: at() },
    );
    expect(status(state, 'NAGPUR')).not.toBe('agreement');
    for (const [field, answer] of [
      ['action', 'send'],
      ['quantity', '8'],
      ['unit', 'parcels'],
      ['notBefore', 'after 3 PM'],
      ['quantity', '8'],
    ] as const) {
      state = submitReadback(state, answer, {
        at: at(),
        scopeItemIds: ['NAGPUR'],
        answerField: field,
      });
      expect(status(state, 'NAGPUR')).not.toBe('agreement');
      expect(() => confirmItem(state, 'NAGPUR')).toThrow();
    }
    // The stored mark survives a reload without reopening anything new.
    const restored = restoreHandover(JSON.parse(JSON.stringify(state)));
    expect(compareHandover(restored)).toEqual(compareHandover(state));
    expect(restored.events.length).toBe(state.events.length);

    state = submitReadback(state, 'I will send eight Nagpur parcels after 3 PM.', {
      at: at(),
      scopeItemIds: ['NAGPUR'],
      answerField: 'action',
    });
    expect(status(state, 'NAGPUR')).toBe('agreement');
  });
});

describe('a full restatement after a restatement request', () => {
  it('is idempotent on retry and stable across reload', () => {
    let state = submitReadback(
      createDemoHandover(),
      'I will send eight Nagpur parcels after 3 PM to Pune. I will hold two Joshi parcels until the address is confirmed.',
      { at: at() },
    );
    const request = {
      at: at(),
      scopeItemIds: ['NAGPUR'],
      answerField: 'action' as const,
      utteranceId: 'restated-nagpur',
    };
    state = submitReadback(state, 'I will send eight Nagpur parcels after 3 PM.', request);
    expect(status(state, 'NAGPUR')).toBe('agreement');
    const retried = submitReadback(state, 'I will send eight Nagpur parcels after 3 PM.', request);
    expect(retried.events.length).toBe(state.events.length);
    const restored = restoreHandover(JSON.parse(JSON.stringify(state)));
    expect(compareHandover(restored)).toEqual(compareHandover(state));
    expect(restored.events.length).toBe(state.events.length);
    expect(() => confirmItem(restored, 'NAGPUR')).not.toThrow();
  });
});
