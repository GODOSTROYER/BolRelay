import { describe, expect, it } from 'vitest';
import { compareHandover, confirmItem, createDemoHandover, submitReadback } from '../../src/domain';
import { draftInstructions } from '../../src/domain/draft';
import { actionFromText, canonicalCondition } from '../../src/domain/parser';
import type { HandoverState, Language } from '../../src/domain';
import { validateModelOutput } from '../../server/model';

/*
 * P0: Hindi/Marathi (and romanised Hinglish) negation.
 * Agreement is expected only where the negation is a supported, certain idiom.
 * Anything else must surface an uncertainty rather than drop or flip the negation.
 */

const status = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!.status;
const readback = (language: Language, text: string) =>
  submitReadback(createDemoHandover(language), text);
const lastParse = (state: HandoverState) => state.utterances.at(-1)!;
const codes = (state: HandoverState) => lastParse(state).issues.map((issue) => issue.code);
const joshiClaims = (state: HandoverState) =>
  lastParse(state).claims.filter((claim) => claim.itemIds.includes('J1'));

describe('supported Hindi/Marathi prohibitions mean hold, never dispatch', () => {
  it.each([
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म होने तक न भेजें।'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक न भेजूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक नहीं भेजूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक नहीं भेजूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल जब तक पता कन्फर्म न हो जाए तब तक रोक कर रखूंगा।'],
    ['mr-IN', 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल पाठवू नका.'],
    ['mr-IN', 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल नको पाठवू.'],
    ['mr-IN', 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल पाठवायचे नाहीत.'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत पाठवणार नाही.'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म होईपर्यंत न पाठवता ठेवेन.'],
  ] as [Language, string][])('%s: %s', (language, text) => {
    const state = readback(language, text);
    expect(codes(state)).toEqual([]);
    expect(joshiClaims(state).map((claim) => [claim.action, claim.condition])).toEqual([
      ['hold', 'address confirmed'],
    ]);
    expect(status(state, 'J1')).toBe('agreement');
    expect(status(state, 'J2')).toBe('agreement');
  });

  it.each([
    ['दो जोशी पार्सल न भेजें।', 'hold'],
    ['दो जोशी पार्सल मत भेजो।', 'hold'],
    ['दोन जोशी पार्सल पाठवू नका.', 'hold'],
    ['दोन जोशी पार्सल नको पाठवू.', 'hold'],
    ['दोन जोशी पार्सल पाठवायचे नाहीत.', 'hold'],
  ])('actionFromText reads the prohibition, not the bare verb: %s', (text, action) => {
    expect(actionFromText(text)).toBe(action);
  });
});

describe('a negated hold never becomes a hold agreement', () => {
  it.each([
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म होने तक न रोकें।'],
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म होने तक मत रोको।'],
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म होने तक रोकना नहीं।'],
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म होने तक मत रखो।'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक नहीं रोकूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक रोक कर नहीं रखूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोकूंगा नहीं।'],
    ['hi-IN', 'मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक मत रोको।'],
    ['mr-IN', 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवू नका.'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत ठेवू नका.'],
    ['mr-IN', 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल नको थांबवू.'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवणार नाही.'],
    ['mr-IN', 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवायचे नाहीत.'],
    ['mr-IN', 'मी दोन जोशी पार्सल जोपर्यंत पत्त्याची पुष्टी होत नाही तोपर्यंत थांबवणार नाही.'],
  ] as [Language, string][])('%s: %s', (language, text) => {
    const state = readback(language, text);
    expect(status(state, 'J1')).toBe('uncertainty');
    expect(status(state, 'J2')).toBe('uncertainty');
    expect(codes(state)).toContain('UNHANDLED_NEGATION');
    // A negated hold is not recorded as the positive action.
    for (const claim of joshiClaims(state)) expect(claim.action).toBeUndefined();
    expect(() => confirmItem(state, 'J1')).toThrow();
  });
});

describe('a negated Hindi/Marathi prerequisite never collapses to "address confirmed"', () => {
  it.each([
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म हुए बिना भेज दूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म हुए बगैर भेजूंगा।'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म न करता पाठवेन.'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म झाल्याशिवाय पाठवेन.'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याच्या पुष्टीविना पाठवेन.'],
    // Double negation: plausibly "hold until confirmed", but not safely handled locally.
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म हुए बिना नहीं भेजूंगा।'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म झाल्याशिवाय पाठवू नका.'],
    // Negation inside the prerequisite itself, outside a supported जब तक/जोपर्यंत idiom.
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म न होने तक रोकूंगा।'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म न हो तब तक रोकूंगा।'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म न होईपर्यंत थांबवेन.'],
  ] as [Language, string][])('%s: %s', (language, text) => {
    const state = readback(language, text);
    expect(status(state, 'J1')).toBe('uncertainty');
    expect(status(state, 'J2')).toBe('uncertainty');
    expect(codes(state)).toContain('NEGATED_PREREQUISITE');
    for (const claim of joshiClaims(state)) {
      expect(claim.condition).not.toBe('address confirmed');
      expect(claim.uncertainFields).toContain('condition');
    }
  });

  it.each([
    'पता कन्फर्म हुए बिना',
    'पता कन्फर्म हुए बगैर',
    'पत्ता कन्फर्म न करता',
    'पत्ता कन्फर्म झाल्याशिवाय',
    'पत्त्याच्या पुष्टीविना',
    'पता कन्फर्म न हो',
    'पत्ता कन्फर्म नको',
    'address confirm nahi hua',
    'address confirm hue bina',
  ])('canonicalCondition keeps the negation: %s', (condition) => {
    expect(canonicalCondition(condition)).not.toBe('address confirmed');
  });
});

describe('negation scope across corrections and alternatives', () => {
  it.each([
    ['hi-IN', 'मैं दो जोशी पार्सल भेजूंगा, नहीं, रोकूंगा।', 'J1'],
    ['hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा, नहीं भेजूंगा।', 'NAGPUR'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक रोकूंगा नहीं तो भेज दूंगा।', 'J1'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक रोकूंगा वरना भेज दूंगा।', 'J1'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत पाठवेन नाहीतर थांबवेन.', 'J1'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवेन नाही तर पाठवेन.', 'J1'],
    // Past-tense negation is a status report, not a planned hold.
    ['hi-IN', 'मैंने दो जोशी पार्सल नहीं भेजा।', 'J1'],
    ['hi-IN', 'मैंने दो जोशी पार्सल भेजे नहीं।', 'J1'],
    ['mr-IN', 'मी दोन जोशी पार्सल पाठवले नाहीत.', 'J1'],
    // A trailing ना may be a tag ("won't you") or a negation; not safely placed.
    ['hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा ना।', 'NAGPUR'],
  ] as [Language, string, string][])('%s: %s stays uncertain', (language, text, id) => {
    const state = readback(language, text);
    expect(status(state, id)).toBe('uncertainty');
  });

  it.each([
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म होने तक रोकूंगा नहीं तो भेज दूंगा।'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत पाठवेन नाहीतर थांबवेन.'],
  ] as [Language, string][])('"otherwise" is an alternative action: %s', (language, text) => {
    expect(codes(readback(language, text))).toContain('COMPETING_ACTIONS');
  });

  it.each([
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद न भेजें।'],
    ['hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद नहीं भेजूंगा।'],
    ['mr-IN', 'आठ नागपूर पार्सल दुपारी तीन नंतर पाठवू नका.'],
    ['en-IN', 'I will not send eight Nagpur parcels after 3 PM.'],
  ] as [Language, string][])(
    'a prohibition "after" a time is not "hold until" that time: %s',
    (language, text) => {
      const state = readback(language, text);
      expect(status(state, 'NAGPUR')).toBe('uncertainty');
      const claim = lastParse(state).claims.find((c) => c.itemIds.includes('NAGPUR'))!;
      expect(claim.notBefore).toBeUndefined();
      expect(claim.uncertainFields).toEqual(expect.arrayContaining(['action', 'notBefore']));
      expect(codes(state)).toContain('NEGATED_TIME');
    },
  );
});

describe('a verb negation is not a quantity self-correction', () => {
  it('does not take a time numeral as the corrected count', () => {
    const state = readback('hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे से पहले नहीं भेजूंगा।');
    const claim = lastParse(state).claims.find((c) => c.itemIds.includes('NAGPUR'))!;
    expect(claim.quantity).not.toBe(3);
    expect(status(state, 'NAGPUR')).toBe('uncertainty');
  });

  it('still reads a count corrected between two numbers, without claiming agreement', () => {
    const state = readback('hi-IN', 'मैं बारह नहीं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।');
    const claim = lastParse(state).claims.find((c) => c.itemIds.includes('NAGPUR'))!;
    expect(claim.quantity).toBe(8);
    // Deliberately conservative: Indic count corrections still ask for a clean restatement.
    expect(status(state, 'NAGPUR')).toBe('uncertainty');
  });
});

describe('romanised Hinglish negation is not dropped', () => {
  it.each([
    'I will send eight Nagpur parcels after 3 PM nahi.',
    'Main eight Nagpur parcels after 3 PM send nahi karunga.',
    'Eight Nagpur parcels after 3 PM send mat karna.',
    'Eight Nagpur parcels after 3 PM send na karna.',
  ])('%s', (text) => {
    const state = readback('en-IN', text);
    expect(status(state, 'NAGPUR')).toBe('uncertainty');
    expect(codes(state)).toContain('UNHANDLED_NEGATION');
    for (const claim of lastParse(state).claims) expect(claim.action).not.toBe('dispatch');
  });
});

describe('words that merely contain न/ना are not negation', () => {
  it.each([['mr-IN', 'मी आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन.']] as [Language, string][])(
    '%s: %s',
    (language, text) => {
      const state = readback(language, text);
      expect(codes(state)).toEqual([]);
      expect(status(state, 'NAGPUR')).toBe('agreement');
    },
  );

  // These words (new, hello, "numbered") are not negation, but they are content words the
  // local rules do not explain, so the closed-world check now leaves the item uncertain.
  it.each([
    ['hi-IN', 'मैं आठ नए नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'नमस्ते मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं आठ नागपुर पार्सल नंबर वाले दोपहर तीन बजे के बाद भेजूंगा।'],
    ['mr-IN', 'मी आठ नवीन नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
  ] as [Language, string][])('%s: %s', (language, text) => {
    const state = readback(language, text);
    expect(codes(state)).toEqual(['UNEXPLAINED_WORDING']);
    expect(lastParse(state).claims[0]?.action).toBe('dispatch');
  });

  it('drafts a plan whose numbers (नौ, नऊ) begin with न', () => {
    for (const [language, text] of [
      ['hi-IN', 'नौ पुणे पार्सल सुबह नौ बजे के बाद भेजना।'],
      ['mr-IN', 'नऊ पुणे पार्सल सकाळी नऊ नंतर पाठवा.'],
    ] as [Language, string][]) {
      const draft = draftInstructions(text, language);
      expect(draft.problems).toEqual([]);
      expect(draft.items.map((item) => [item.quantity, item.action, item.notBefore])).toEqual([
        [9, 'dispatch', '09:00'],
      ]);
    }
  });
});

describe('outgoing instruction drafts apply the same negation rules', () => {
  it('reads "न भेजें" until confirmation as a hold, not a dispatch', () => {
    const draft = draftInstructions('दो जोशी पार्सल पता कन्फर्म होने तक न भेजें।', 'hi-IN');
    expect(draft.problems).toEqual([]);
    expect(draft.items.map((item) => [item.action, item.condition])).toEqual([
      ['hold', 'address confirmed'],
    ]);
  });

  it.each([
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म होने तक न रोकें।'],
    ['hi-IN', 'दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक मत रोको।'],
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म हुए बिना भेजना।'],
    ['hi-IN', 'दो जोशी पार्सल पता कन्फर्म न हो तब तक रोकना।'],
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद न भेजें।'],
    ['hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजना नहीं तो रोकना।'],
    ['mr-IN', 'दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवू नका.'],
    ['mr-IN', 'दोन जोशी पार्सल पत्ता कन्फर्म न करता पाठवा.'],
    ['en-IN', 'Send eight Nagpur parcels after 3 PM nahi.'],
  ] as [Language, string][])('does not create a plan from %s: %s', (language, text) => {
    const draft = draftInstructions(text, language);
    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.items).toEqual([]);
  });
});

describe('model guard rejects claims that drop a Hindi/Marathi negation', () => {
  const request = (language: Language, text: string) => ({
    text,
    role: 'incoming' as const,
    language,
    utteranceId: 'recording-neg',
    items: createDemoHandover(language).items,
  });
  const joshiClaim = (
    text: string,
    claim: {
      action: string;
      condition?: string;
      fieldEvidence: Record<string, string>;
      uncertainFields?: string[];
    },
  ) => ({
    claims: [
      {
        itemIds: ['J1', 'J2'],
        action: claim.action,
        quantity: 2,
        unit: 'parcel',
        ...(claim.condition ? { condition: claim.condition } : {}),
        uncertainFields: claim.uncertainFields ?? [],
        evidenceQuote: text,
        fieldEvidence: claim.fieldEvidence,
      },
    ],
    issues: [],
    limitations: [],
  });

  it('rejects a hold claim that drops "नका" from a Marathi negated hold', () => {
    const text = 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवू नका.';
    const body = joshiClaim(text, {
      action: 'hold',
      condition: 'address confirmed',
      fieldEvidence: {
        object: 'जोशी',
        action: 'थांबवू',
        quantity: 'दोन',
        unit: 'पार्सल',
        condition: 'पत्त्याची पुष्टी होईपर्यंत',
      },
    });
    expect(() => validateModelOutput(body, request('mr-IN', text))).toThrow();
  });

  it('rejects a dispatch claim that drops "न" from a Hindi prohibition', () => {
    const text = 'दो जोशी पार्सल पता कन्फर्म होने तक न भेजें।';
    const body = joshiClaim(text, {
      action: 'dispatch',
      fieldEvidence: { object: 'जोशी', action: 'भेजें', quantity: 'दो', unit: 'पार्सल' },
    });
    expect(() => validateModelOutput(body, request('hi-IN', text))).toThrow();
  });

  it.each([
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म हुए बिना भेज दूंगा।', 'दो', 'भेज दूंगा', 'पता कन्फर्म'],
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म हुए बिना भेज दूंगा।', 'दो', 'भेज दूंगा', 'पता कन्फर्म हुए बिना'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म न करता पाठवेन.', 'दोन', 'पाठवेन', 'पत्ता कन्फर्म'],
  ] as [Language, string, string, string, string][])(
    'rejects "address confirmed" for a negated prerequisite: %s / %s / %s',
    (language, text, quantity, action, condition) => {
      const body = joshiClaim(text, {
        action: 'dispatch',
        condition: 'address confirmed',
        fieldEvidence: { object: 'जोशी', quantity, unit: 'पार्सल', action, condition },
      });
      expect(() => validateModelOutput(body, request(language, text))).toThrow();
    },
  );

  it('still accepts a faithful hold for a supported Marathi prohibition', () => {
    const text = 'पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल पाठवू नका.';
    const body = joshiClaim(text, {
      action: 'hold',
      condition: 'address confirmed',
      fieldEvidence: {
        object: 'जोशी',
        action: 'पाठवू नका',
        quantity: 'दोन',
        unit: 'पार्सल',
        condition: 'पत्त्याची पुष्टी होईपर्यंत',
      },
    });
    const parsed = validateModelOutput(body, request('mr-IN', text));
    expect(parsed.claims[0]).toMatchObject({ action: 'hold', condition: 'address confirmed' });
  });
});
