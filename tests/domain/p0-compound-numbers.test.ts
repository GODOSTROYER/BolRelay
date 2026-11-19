import { describe, expect, it } from 'vitest';
import { compareHandover, confirmItem, createHandover, submitReadback } from '../../src/domain';
import { draftInstructions } from '../../src/domain/draft';
import { createDemoHandover } from '../../src/domain/fixtures';
import { normalizeNumbers, parseTranscript, readQuantity } from '../../src/domain/parser';
import type { HandoverState, Language } from '../../src/domain';
import { validateModelOutput } from '../../server/model';

// P0: a compound number (38, 88, 28, 108, ...) must never be read as its last
// unit word (8). It is either composed exactly or left as an uncertainty.

const nagpur = (state: HandoverState) =>
  compareHandover(state).find((item) => item.itemId === 'NAGPUR')!;
const parse = (text: string, language: Language = 'en-IN') =>
  parseTranscript({ text, role: 'incoming', language, items: createDemoHandover().items });
const nagpurClaim = (text: string, language: Language = 'en-IN') =>
  parse(text, language).claims.find((claim) => claim.itemIds.includes('NAGPUR'));
const issueCodes = (text: string, language: Language = 'en-IN') =>
  parse(text, language).issues.map((issue) => issue.code);

describe('English tens + unit numbers are composed, never truncated', () => {
  it.each([
    ['thirty eight', 38],
    ['eighty eight', 88],
    ['eighty-eight', 88],
    ['twenty-eight', 28],
    ['twenty eight', 28],
    ['twenty-one', 21],
    ['ninety nine', 99],
    ['forty', 40],
    ['thirty', 30],
    ['38', 38],
    ['३८', 38],
  ])('reads "%s" as %i', (amount, expected) => {
    const text = `I will send ${amount} Nagpur parcels after 3 PM.`;
    const claim = nagpurClaim(text)!;
    expect(claim.quantity).toBe(expected);
    expect(claim.uncertainFields).not.toContain('quantity');
    const state = submitReadback(createDemoHandover(), text);
    expect(nagpur(state).status).toBe('contradiction');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });

  it('normalises compounds as whole numbers', () => {
    expect(normalizeNumbers('thirty eight')).toBe('38');
    expect(normalizeNumbers('Twenty-Eight parcels')).toBe('28 parcels');
    expect(normalizeNumbers('eighteen and eighty')).toBe('18 and 80');
  });

  it.each([
    'Actually I will send twenty-eight Nagpur parcels after 3 PM.',
    'Sorry, I will send thirty eight Nagpur parcels after 3 PM.',
    'No, I mean I will send eighty eight Nagpur parcels after 3 PM.',
  ])('a correction word elsewhere never splits a compound: %s', (text) => {
    expect(nagpurClaim(text)?.quantity).not.toBe(8);
    const state = submitReadback(createDemoHandover(), text);
    expect(nagpur(state).status).not.toBe('agreement');
  });

  it('applies an explicit correction between two whole numbers', () => {
    expect(
      nagpurClaim('I will send ten, no, twenty eight Nagpur parcels after 3 PM.')!.quantity,
    ).toBe(28);
    expect(
      nagpurClaim('I will send thirty eight, sorry, eight Nagpur parcels after 3 PM.')!.quantity,
    ).toBe(8);
  });

  it.each([
    'Actually I will send twenty 8 Nagpur parcels after 3 PM.',
    'I will send eight thirty Nagpur parcels after 3 PM.',
    'I will send eight-thirty Nagpur parcels after 3 PM.',
  ])('adjacent numbers with no correction between them stay unresolved: %s', (text) => {
    expect(nagpurClaim(text)!.quantity).toBeUndefined();
    expect(nagpurClaim(text)!.uncertainFields).toContain('quantity');
    expect(nagpur(submitReadback(createDemoHandover(), text)).status).toBe('uncertainty');
  });
});

describe('unsupported number wording is an uncertainty, never a partial number', () => {
  it.each([
    'a hundred and eight',
    'one hundred eight',
    'fourty eight',
    'fourty-eight',
    'thirty-eighth',
    'thirty eighth',
    'double eight',
    '1,008',
    'twenty-twenty',
  ])('"%s" yields no quantity and UNSUPPORTED_QUANTITY_EXPRESSION', (amount) => {
    const text = `I will send ${amount} Nagpur parcels after 3 PM.`;
    const claim = nagpurClaim(text)!;
    expect(claim.quantity).toBeUndefined();
    expect(claim.uncertainFields).toContain('quantity');
    expect(issueCodes(text)).toContain('UNSUPPORTED_QUANTITY_EXPRESSION');
    const state = submitReadback(createDemoHandover(), text);
    expect(nagpur(state).status).toBe('uncertainty');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });

  it('does not treat an unrelated word as a multiplier', () => {
    const text = 'I will double check and send eight Nagpur parcels after 3 PM.';
    expect(nagpurClaim(text)!.quantity).toBe(8);
    expect(issueCodes(text)).not.toContain('UNSUPPORTED_QUANTITY_EXPRESSION');
  });

  it('keeps a written digit group in one clause', () => {
    const claims = parse('I will send 1,008 Nagpur parcels after 3 PM.').claims;
    expect(claims).toHaveLength(1);
    expect(claims[0]!.quantity).toBeUndefined();
  });
});

describe('Hindi and Marathi compound numbers never reduce to आठ / 8', () => {
  it.each([
    ['hi-IN', 'मैं अड़तीस नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं अड़तीस नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'.normalize('NFD')],
    ['hi-IN', 'मैं अडतीस नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं अट्ठासी नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं अठ्ठासी नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं अट्ठाईस नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं चौबीस नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं साढ़े आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं पौने आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं सवा आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['hi-IN', 'मैं डबल आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
    ['mr-IN', 'मी अडतीस नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'मी अठ्ठ्याऐंशी नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'मी अठ्याऐंशी नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'मी अठ्ठावीस नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'मी बावीस नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'मी एकोणीस नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
    ['mr-IN', 'मी साडे आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन.'],
  ] as const)('%s: %s', (language, text) => {
    const claim = nagpurClaim(text, language)!;
    expect(claim.quantity).toBeUndefined();
    expect(claim.uncertainFields).toContain('quantity');
    expect(issueCodes(text, language)).toContain('UNSUPPORTED_QUANTITY_EXPRESSION');
    const state = submitReadback(createDemoHandover(language), text);
    expect(nagpur(state).status).toBe('uncertainty');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });

  it('does not read a number word inside a longer Devanagari word', () => {
    expect(normalizeNumbers('अठ्ठावीस')).toBe('अठ्ठावीस');
    expect(normalizeNumbers('एकोणीस')).toBe('एकोणीस');
    expect(normalizeNumbers('आठों')).toBe('आठों');
    // Supported small numbers still work.
    expect(normalizeNumbers('आठ वीस बीस')).toBe('8 20 20');
  });

  it('keeps the supported demo wording exact', () => {
    for (const [language, text] of [
      ['hi-IN', 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'],
      ['mr-IN', 'मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवेन.'],
    ] as const) {
      expect(nagpurClaim(text, language)!.quantity).toBe(8);
      expect(nagpur(submitReadback(createDemoHandover(language), text)).status).toBe('agreement');
    }
  });
});

describe('times and identifiers are not quantities', () => {
  it('a time with minutes 38 does not supply the count', () => {
    const claim = nagpurClaim('I will send Nagpur parcels after 8:38 PM.')!;
    expect(claim.quantity).toBeUndefined();
    expect(claim.notBefore).toBe('20:38');
    expect(nagpurClaim('I will send eight Nagpur parcels after 8:38 PM.')!.quantity).toBe(8);
  });

  const routeHandover = () =>
    createHandover({
      items: [
        {
          id: 'R8',
          label: 'Route 8',
          aliases: ['Route 8', '38'],
          quantity: 8,
          unit: 'box',
          action: 'pack',
          notBefore: null,
          condition: null,
          owner: null,
        },
      ],
    });

  it.each(['I will pack the Route 8 boxes.', 'I will pack the 38 boxes.'])(
    'a number inside an item name or alias is not read as a quantity: %s',
    (text) => {
      const parsed = parseTranscript({
        text,
        role: 'incoming',
        language: 'en-IN',
        items: routeHandover().items,
      });
      expect(parsed.claims[0]!.itemIds).toEqual(['R8']);
      expect(parsed.claims[0]!.quantity).toBeUndefined();
      expect(compareHandover(submitReadback(routeHandover(), text))[0]!.status).not.toBe(
        'agreement',
      );
    },
  );

  it('an explicit count beside a numbered name is still read', () => {
    const state = submitReadback(routeHandover(), 'I will pack eight Route 8 boxes.');
    expect(state.readbacks.R8!.claims[0]!.quantity).toBe(8);
    expect(compareHandover(state)[0]!.status).toBe('agreement');
  });
});

describe('draft creation from an outgoing instruction', () => {
  it.each([
    ['Send thirty eight Pune parcels after 9 AM.', 38],
    ['Send eighty-eight Pune parcels after 9 AM.', 88],
    ['Send ३८ Pune parcels after 9 AM.', 38],
  ])('%s → %i', (text, quantity) => {
    const draft = draftInstructions(text, 'en-IN');
    expect(draft.problems).toEqual([]);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]!.quantity).toBe(quantity);
  });

  it.each([
    'Send fourty eight Pune parcels after 9 AM.',
    'Send thirty-eighth Pune parcels after 9 AM.',
    'Send hundred eight Pune parcels after 9 AM.',
  ])('blocks a draft whose number wording is not understood: %s', (text) => {
    const draft = draftInstructions(text, 'en-IN');
    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.items.every((item) => item.quantity !== 8)).toBe(true);
  });

  it('blocks a Hindi compound-number draft', () => {
    const draft = draftInstructions('अड़तीस पुणे पार्सल सुबह नौ बजे के बाद भेजना।', 'hi-IN');
    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.items.every((item) => item.quantity !== 8)).toBe(true);
  });
});

describe('readQuantity', () => {
  it('reads one whole count or reports why it cannot', () => {
    expect(readQuantity('thirty eight')).toEqual({ quantity: 38, issues: [] });
    expect(readQuantity('eight').quantity).toBe(8);
    expect(readQuantity('ten, no, eight').quantity).toBe(8);
    expect(readQuantity('twenty 8').quantity).toBeUndefined();
    expect(readQuantity('a hundred and eight').quantity).toBeUndefined();
  });
});

describe('model quantity evidence uses the same number rules', () => {
  const base = (text: string, quantityQuote: string, quantity: number) => ({
    input: {
      text,
      role: 'incoming' as const,
      language: 'en-IN' as const,
      utteranceId: 'recording-compound',
      items: createDemoHandover().items,
    },
    output: {
      claims: [
        {
          itemIds: ['NAGPUR'],
          action: 'dispatch',
          quantity,
          unit: 'parcel',
          notBefore: '15:00',
          uncertainFields: [],
          evidenceQuote: text,
          fieldEvidence: {
            object: 'Nagpur',
            action: 'send',
            quantity: quantityQuote,
            unit: 'parcels',
            notBefore: 'after 3 PM',
          },
        },
      ],
      issues: [],
      limitations: [],
    },
  });

  it.each([
    ['I will send thirty eight Nagpur parcels after 3 PM.', 'thirty eight'],
    ['I will send thirty eight Nagpur parcels after 3 PM.', 'eight'],
    ['I will send eighty-eight Nagpur parcels after 3 PM.', 'eight'],
    ['I will send twenty-eight Nagpur parcels after 3 PM.', 'twenty-eight'],
    ['I will send 38 Nagpur parcels after 3 PM.', '38'],
    ['I will send a hundred and eight Nagpur parcels after 3 PM.', 'eight'],
    ['I will send 1,008 Nagpur parcels after 3 PM.', '008'],
    ['Actually I will send twenty 8 Nagpur parcels after 3 PM.', '8'],
  ])('rejects quantity 8 for %s (evidence "%s")', (text, quote) => {
    const { input, output } = base(text, quote, 8);
    expect(() => validateModelOutput(output, input)).toThrow();
  });

  it.each([
    ['I will send thirty eight Nagpur parcels after 3 PM.', 'thirty eight', 38],
    ['I will send eighty-eight Nagpur parcels after 3 PM.', 'eighty-eight', 88],
    ['I will send eight Nagpur parcels after 3 PM.', 'eight', 8],
    ['I will send twelve, sorry eight Nagpur parcels after 3 PM.', 'twelve, sorry eight', 8],
  ])('accepts the whole stated count for %s', (text, quote, quantity) => {
    const { input, output } = base(text, quote, quantity);
    expect(validateModelOutput(output, input).claims[0]!.quantity).toBe(quantity);
  });
});
