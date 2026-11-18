import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  confirmItem,
  createDemoHandover,
  createHandover,
  DEMO_TRANSCRIPTS,
  parseTranscript,
  restoreHandover,
  reviseItem,
  submitReadback,
} from '../../src/domain';
import { createReviewedHandover, draftInstructions } from '../../src/domain/draft';
import { canonicalCondition } from '../../src/domain/parser';
import { importHandover, serializeHandoverExport } from '../../src/lib/export';
import { validateModelOutput } from '../../server/model';
import type { HandoverState, ItemInput, Language } from '../../src/domain';

const status = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!.status;

const board = (items: ItemInput[]) => createHandover({ items });
const dispatchItem = (condition: string | null): ItemInput => ({
  id: 'P1',
  label: 'Pune parcels',
  aliases: ['Pune', 'पुणे'],
  quantity: 2,
  unit: 'parcel',
  action: 'dispatch',
  notBefore: null,
  condition,
  owner: null,
});
const compoundHold = (): HandoverState =>
  board([
    {
      id: 'J1',
      label: 'Joshi parcels',
      aliases: ['Joshi', 'जोशी'],
      quantity: 2,
      unit: 'parcel',
      action: 'hold',
      notBefore: null,
      condition: 'address confirmed and payment received',
      owner: null,
    },
  ]);

describe('exclusions are never inverted into a claim about the excluded item', () => {
  it.each([
    ['en-IN', 'Send all parcels except J1.'],
    ['en-IN', 'I will send everything but J2.'],
    ['en-IN', 'I will send all parcels other than J1.'],
    ['en-IN', 'I will send all excluding J1.'],
    ['en-IN', 'I will send all parcels apart from J1.'],
    ['hi-IN', 'J1 को छोड़कर सब भेजो।'],
    ['hi-IN', 'J1 के सिवाय सब भेजो।'],
    ['mr-IN', 'J1 सोडून सगळे पाठवा.'],
    ['mr-IN', 'J1 वगळून सगळे पाठवा.'],
  ] satisfies [Language, string][])('%s: %s', (language, text) => {
    const initial = createDemoHandover();
    const parsed = parseTranscript({ text, role: 'incoming', language, items: initial.items });
    // Before the fix the excluded ID became the only dispatch target.
    expect(parsed.claims.some((claim) => claim.action === 'dispatch')).toBe(false);
    expect(parsed.issues.map((issue) => issue.code)).toContain('UNSUPPORTED_EXCLUSION');
    const state = submitReadback(initial, text, { language });
    for (const id of ['NAGPUR', 'J1', 'J2']) {
      expect(status(state, id)).toBe('uncertainty');
      expect(() => confirmItem(state, id)).toThrow();
    }
  });

  it('an exclusion cannot read as agreement for an item whose plan is dispatch', () => {
    const initial = board([
      { ...dispatchItem(null), id: 'X1', label: 'Parcel X1', aliases: [], quantity: 1 },
      { ...dispatchItem(null), id: 'X2', label: 'Parcel X2', aliases: [], quantity: 1 },
    ]);
    // Previously: claim {X1, dispatch, 1 parcel} => X1 agreement, the opposite of what was said.
    const state = submitReadback(initial, 'I will send the one parcel except X1.');
    expect(status(state, 'X1')).not.toBe('agreement');
    expect(() => confirmItem(state, 'X1')).toThrow();
  });

  it('an outgoing exclusion never becomes an instruction for the excluded item', () => {
    const parsed = parseTranscript({
      text: 'Send all parcels except J1.',
      role: 'outgoing',
      language: 'en-IN',
      items: createDemoHandover().items,
    });
    expect(parsed.claims).toEqual([]);
  });

  it('keeps the Marathi release verb "सोडून द्या" as a dispatch, not an exclusion', () => {
    const parsed = parseTranscript({
      text: 'मी एक पार्सल J1 सोडून देईन.',
      role: 'incoming',
      language: 'mr-IN',
      items: createDemoHandover().items,
    });
    expect(parsed.issues.map((issue) => issue.code)).not.toContain('UNSUPPORTED_EXCLUSION');
    expect(parsed.claims[0]).toMatchObject({ itemIds: ['J1'], action: 'dispatch' });
  });

  it('blocks a draft whose instruction is stated as an exclusion', () => {
    for (const text of ['Send two Pune parcels other than P1.', 'Send all parcels except P1.']) {
      const draft = draftInstructions(text, 'en-IN');
      expect(draft.problems.length).toBeGreaterThan(0);
      expect(() => createReviewedHandover(draft, {})).toThrow();
    }
  });
});

describe('compound prerequisites keep every conjunct', () => {
  it('canonicalises each conjunct, independent of order, and never to its first part', () => {
    expect(canonicalCondition('the address is confirmed and payment is received')).toBe(
      'address confirmed and payment received',
    );
    expect(canonicalCondition('payment is received and the address is verified')).toBe(
      'address confirmed and payment received',
    );
    expect(canonicalCondition('until the address is confirmed')).toBe('address confirmed');
    expect(canonicalCondition('address confirmed or payment received')).not.toBe(
      'address confirmed',
    );
  });

  it('a read-back adding a second prerequisite is not agreement with a single-condition plan', () => {
    const text =
      'I will hold two Joshi parcels until the address is confirmed and payment is received.';
    const state = submitReadback(createDemoHandover(), text);
    expect(state.utterances.at(-1)!.claims[0]!.condition).toBe(
      'address confirmed and payment received',
    );
    expect(status(state, 'J1')).not.toBe('agreement');
    expect(() => confirmItem(state, 'J1')).toThrow();
  });

  it('a read-back dropping one prerequisite is not agreement', () => {
    const state = submitReadback(
      compoundHold(),
      'I will hold two Joshi parcels until the address is confirmed.',
    );
    expect(status(state, 'J1')).not.toBe('agreement');
    expect(() => confirmItem(state, 'J1')).toThrow();
  });

  it.each([
    'I will hold two Joshi parcels until the address is confirmed and payment is received.',
    'I will hold two Joshi parcels until payment is received and the address is verified.',
  ])('a complete compound read-back matches: %s', (text) => {
    expect(status(submitReadback(compoundHold(), text), 'J1')).toBe('agreement');
  });

  it.each([
    ['hi-IN', 'मैं दो जोशी पार्सल पता कन्फर्म और पेमेंट मिलने तक रोक कर रखूंगा।'],
    ['mr-IN', 'मी दोन जोशी पार्सल पत्ता कन्फर्म आणि पेमेंट मिळेपर्यंत थांबवेन.'],
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM and payment is received.'],
  ] satisfies [Language, string][])(
    'an unparsed second prerequisite is uncertain, not dropped: %s',
    (language, text) => {
      const state = submitReadback(createDemoHandover(), text, { language });
      const id = text.includes('Nagpur') ? 'NAGPUR' : 'J1';
      expect(status(state, id)).toBe('uncertainty');
      expect(() => confirmItem(state, id)).toThrow();
    },
  );

  it('blocks a compound-prerequisite draft rather than keeping only one condition', () => {
    const draft = draftInstructions(
      'Hold two Pune parcels until the address is confirmed and payment is received.',
      'en-IN',
    );
    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.items.some((item) => item.condition === 'address confirmed')).toBe(false);
  });
});

describe('conditional phrasing beyond "until" is never silently dropped', () => {
  it.each([
    'I will send two Pune parcels only if payment is received.',
    'I will send two Pune parcels if payment is received.',
    'I will send two Pune parcels provided that payment is received.',
    'I will send two Pune parcels as soon as payment is received.',
    'I will send two Pune parcels after payment is received.',
    'I will send two Pune parcels once payment is received.',
  ])('a stated prerequisite matches the planned one: %s', (text) => {
    const state = submitReadback(board([dispatchItem('payment received')]), text);
    expect(state.utterances.at(-1)!.claims[0]!.condition).toBe('payment received');
    expect(status(state, 'P1')).toBe('agreement');
  });

  it('a read-back without the prerequisite is an omission', () => {
    const state = submitReadback(
      board([dispatchItem('payment received')]),
      'I will send two Pune parcels.',
    );
    expect(status(state, 'P1')).toBe('omission');
  });

  it.each([
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM only if payment is received.'],
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM if payment is received.'],
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM provided that the truck is loaded.'],
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM as soon as payment is received.'],
    ['en-IN', 'I will send eight Nagpur parcels after 3 PM before the truck leaves.'],
    ['hi-IN', 'अगर पेमेंट मिल जाए तो मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'पेमेंट मिलने के बाद ही मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['mr-IN', 'पेमेंट मिळाले तरच मी आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'पेमेंट मिळाल्यावरच मी आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
  ] satisfies [Language, string][])(
    'an added prerequisite is not agreement with an unconditional plan: %s',
    (language, text) => {
      // Before the fix these compared as agreement: the condition was ignored.
      const state = submitReadback(createDemoHandover(), text, { language });
      expect(status(state, 'NAGPUR')).toBe('uncertainty');
      expect(() => confirmItem(state, 'NAGPUR')).toThrow();
    },
  );

  it.each([
    ['hi-IN', 'अगर पता कन्फर्म हो तो मैं दो जोशी पार्सल भेजूंगा।'],
    ['hi-IN', 'पता कन्फर्म होने के बाद ही मैं दो जोशी पार्सल भेजूंगा।'],
    ['mr-IN', 'पत्ता कन्फर्म झाला तरच मी दोन जोशी पार्सल पाठवेन.'],
    ['mr-IN', 'पत्ता कन्फर्म झाल्यावरच मी दोन जोशी पार्सल पाठवेन.'],
  ] satisfies [Language, string][])('reads an Indic address prerequisite: %s', (lang, text) => {
    const parsed = parseTranscript({
      text,
      role: 'incoming',
      language: lang,
      items: createDemoHandover().items,
    });
    expect(parsed.claims[0]).toMatchObject({ action: 'dispatch', condition: 'address confirmed' });
  });

  it('a condition that gates the hold itself is not a release prerequisite', () => {
    const state = submitReadback(
      createDemoHandover(),
      'I will hold two Joshi parcels only if the address is confirmed.',
    );
    expect(status(state, 'J1')).toBe('uncertainty');
  });

  it.each(['en-IN', 'hi-IN', 'mr-IN'] as const)(
    'keeps the demo instruction and its correct read-backs unchanged: %s',
    (language) => {
      const initial = createDemoHandover(language);
      expect(initial.utterances[0]!.claims.map((claim) => claim.condition ?? null)).toEqual([
        null,
        'address confirmed',
      ]);
      for (const text of [
        DEMO_TRANSCRIPTS[language].corrected,
        DEMO_TRANSCRIPTS[language].harmless,
      ]) {
        const state = submitReadback(initial, text, { language });
        for (const id of ['NAGPUR', 'J1', 'J2']) expect(status(state, id)).toBe('agreement');
      }
      const omitted = submitReadback(
        initial,
        DEMO_TRANSCRIPTS[language].corrected.replace(/until the address is confirmed/, ''),
        { language },
      );
      if (language === 'en-IN') expect(status(omitted, 'J1')).toBe('omission');
    },
  );
});

describe('a prerequisite survives draft, revision, export and model paths', () => {
  it.each([
    'Send two Pune parcels after payment is received.',
    'Send two Pune parcels only if payment is received.',
    'Send two Pune parcels as soon as payment is received.',
  ])('draft creation keeps the prerequisite: %s', async (text) => {
    const draft = draftInstructions(text, 'en-IN');
    expect(draft.problems).toEqual([]);
    expect(draft.items[0]).toMatchObject({ action: 'dispatch', condition: 'payment received' });
    const created = createReviewedHandover(draft, {});
    const id = created.items[0]!.id;
    expect(created.items[0]!.condition).toBe('payment received');
    expect(status(submitReadback(created, 'I will send two Pune parcels.'), id)).toBe('omission');
    const agreed = submitReadback(
      created,
      'I will send two Pune parcels once payment is received.',
    );
    expect(status(agreed, id)).toBe('agreement');
    const confirmed = confirmItem(agreed, id);
    const file = new File([serializeHandoverExport(confirmed)], 'handover.json', {
      type: 'application/json',
    });
    const restored = await importHandover(file);
    expect(restored.items[0]!.condition).toBe('payment received');
    expect(restoreHandover(JSON.parse(JSON.stringify(confirmed))).items[0]!.condition).toBe(
      'payment received',
    );
  });

  it.each(['दो पुणे पार्सल अगर पेमेंट मिले तो भेजना।', 'दोन पुणे पार्सल पेमेंट मिळाले तरच पाठवा.'])(
    'an Indic draft prerequisite is never dropped: %s',
    (text) => {
      const draft = draftInstructions(text, text.includes('तरच') ? 'mr-IN' : 'hi-IN');
      expect(draft.problems.map((problem) => problem.code)).toContain('unclear');
      expect(() => createReviewedHandover(draft, {})).toThrow();
    },
  );

  it('revising to a compound prerequisite requires a read-back with every conjunct', () => {
    const agreed = submitReadback(
      createDemoHandover(),
      'I will hold two Joshi parcels until the address is confirmed.',
    );
    const revised = reviseItem(agreed, 'J1', {
      condition: 'address confirmed and payment received',
    });
    expect(status(revised, 'J1')).toBe('omission');
    const partial = submitReadback(
      revised,
      'I will hold one parcel J1 until the address is confirmed.',
      { scopeItemIds: ['J1'] },
    );
    expect(status(partial, 'J1')).not.toBe('agreement');
    const full = submitReadback(
      revised,
      'I will hold one parcel J1 until the address is confirmed and payment is received.',
      { scopeItemIds: ['J1'] },
    );
    expect(status(full, 'J1')).toBe('agreement');
    expect(status(full, 'J2')).toBe('agreement');
  });
});

describe('model extraction cannot drop or narrow a stated prerequisite', () => {
  const items = createDemoHandover().items;
  const input = (text: string) => ({
    text,
    role: 'incoming' as const,
    language: 'en-IN' as const,
    utteranceId: 'recording-p0',
    items,
  });
  const compound =
    'I will hold two Joshi parcels until the address is confirmed and payment is received.';
  const holdClaim = (condition: string | null | undefined, quote?: string) => ({
    claims: [
      {
        itemIds: ['J1', 'J2'],
        action: 'hold',
        quantity: 2,
        unit: 'parcel',
        ...(condition !== undefined ? { condition } : {}),
        uncertainFields: [],
        evidenceQuote: compound,
        fieldEvidence: {
          object: 'Joshi',
          action: 'hold',
          quantity: 'two',
          unit: 'parcels',
          ...(quote ? { condition: quote } : {}),
        },
      },
    ],
    issues: [],
    limitations: [],
  });

  it('rejects a condition narrowed to one conjunct', () => {
    expect(() =>
      validateModelOutput(
        holdClaim('address confirmed', 'until the address is confirmed'),
        input(compound),
      ),
    ).toThrow(/prerequisite/);
  });
  it('rejects an absent condition when one is stated', () => {
    expect(() => validateModelOutput(holdClaim(undefined), input(compound))).toThrow(
      /prerequisite/,
    );
  });
  it('rejects a null condition when one is stated', () => {
    expect(() =>
      validateModelOutput(holdClaim(null, 'until the address is confirmed'), input(compound)),
    ).toThrow(/prerequisite/);
  });
  it('accepts the complete compound prerequisite', () => {
    const parsed = validateModelOutput(
      holdClaim(
        'address confirmed and payment received',
        'until the address is confirmed and payment is received',
      ),
      input(compound),
    );
    expect(parsed.claims[0]!.condition).toBe('address confirmed and payment received');
  });
  it('rejects an added prerequisite the model omitted', () => {
    const text = 'I will send eight Nagpur parcels after 3 PM only if payment is received.';
    const body = {
      claims: [
        {
          itemIds: ['NAGPUR'],
          action: 'dispatch',
          quantity: 8,
          unit: 'parcel',
          notBefore: '15:00',
          uncertainFields: [],
          evidenceQuote: text,
          fieldEvidence: {
            object: 'Nagpur',
            action: 'send',
            quantity: 'eight',
            unit: 'parcels',
            notBefore: 'after 3 PM',
          },
        },
      ],
      issues: [],
      limitations: [],
    };
    expect(() => validateModelOutput(body, input(text))).toThrow(/prerequisite/);
  });
  it('rejects an exclusion turned into a claim about the excluded item', () => {
    const text = 'Send all parcels except J1.';
    const body = {
      claims: [
        {
          itemIds: ['J1'],
          action: 'dispatch',
          uncertainFields: [],
          evidenceQuote: text,
          fieldEvidence: { object: 'J1', action: 'Send' },
        },
      ],
      issues: [],
      limitations: [],
    };
    expect(() => validateModelOutput(body, input(text))).toThrow();
  });
});
