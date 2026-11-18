import { describe, expect, it } from 'vitest';
import { compareHandover, confirmItem, createHandover, submitReadback } from '../../src/domain';
import { createDemoHandover } from '../../src/domain/fixtures';
import { parseTranscript, readQuantity } from '../../src/domain/parser';
import type { HandoverState, Language } from '../../src/domain';
import { validateModelOutput } from '../../server/model';

// Review findings: quantity wording that still reduced to 8 (or to no quantity with no
// uncertainty), and owner extraction that guessed from the clause's first word or from the
// names on the board. Wording that is not safely understood must stay an uncertainty.

const nagpur = (state: HandoverState) =>
  compareHandover(state).find((item) => item.itemId === 'NAGPUR')!;
const parseNagpur = (text: string, language: Language) =>
  parseTranscript({ text, role: 'incoming', language, items: createDemoHandover(language).items });

const sentence: Record<Language, (amount: string) => string> = {
  'en-IN': (amount) => `I will send ${amount} Nagpur parcels after 3 PM.`,
  'hi-IN': (amount) => `मैं ${amount} नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।`,
  'mr-IN': (amount) => `मी ${amount} नागपूर पार्सल दुपारी तीन नंतर पाठवेन.`,
};

const unsupportedAmounts: [Language, string][] = [
  // Marathi hundreds (शे standalone and as a suffix) and सैकडा.
  ['mr-IN', 'एकशे आठ'],
  ['mr-IN', 'दोनशे आठ'],
  ['mr-IN', 'आठ शे'],
  ['mr-IN', 'आठशे'],
  ['mr-IN', 'एकशेआठ'],
  ['mr-IN', 'साडेआठ'],
  ['hi-IN', 'आठ सैकडा'],
  ['hi-IN', 'आठ सैकड़ा'],
  ['hi-IN', 'आठ सैकड़ों'],
  ['hi-IN', 'आठसौ'],
  // Multipliers and collectives.
  ['en-IN', 'eight score'],
  ['en-IN', 'eight pairs of'],
  ['en-IN', 'a gross of eight'],
  ['en-IN', 'eight lots of'],
  ['en-IN', 'eight sets of'],
  ['en-IN', 'eight k'],
  ['en-IN', '8k'],
  ['en-IN', 'thirtyeight'],
  ['hi-IN', 'आठ गुना'],
  ['mr-IN', 'आठ गुणा'],
  ['hi-IN', 'आठ कोड़ी'],
  ['hi-IN', 'आठ जोड़ी'],
  ['mr-IN', 'आठ जोड्या'],
  ['hi-IN', 'आठ हजारों'],
  ['mr-IN', 'आठ पट'],
  // Misspelt tens, alone or with a unit.
  ['hi-IN', 'चालिस आठ'],
  ['hi-IN', 'अट्ठाइस 8'],
  ['hi-IN', 'अठाइस'],
  ['hi-IN', 'चालिस'],
  ['hi-IN', 'पचीस'],
  ['hi-IN', 'अठावन'],
  ['hi-IN', 'अठानवे'],
  ['mr-IN', 'अठ्ठ्यान्नव'],
];

describe('quantity wording that is not safely understood', () => {
  it.each(unsupportedAmounts)('%s "%s" is an uncertainty, never 8', (language, amount) => {
    const text = sentence[language](amount);
    const parsed = parseNagpur(text, language);
    const claim = parsed.claims.find((item) => item.itemIds.includes('NAGPUR'))!;
    expect(claim.quantity).toBeUndefined();
    expect(claim.uncertainFields).toContain('quantity');
    expect(parsed.issues.map((issue) => issue.code)).toContain('UNSUPPORTED_QUANTITY_EXPRESSION');
    expect(readQuantity(amount).quantity).toBeUndefined();
    const state = submitReadback(createDemoHandover(language), text, { language });
    expect(nagpur(state).status).toBe('uncertainty');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });

  it.each([
    ['en-IN', 'eight'],
    ['hi-IN', 'आठ'],
    ['mr-IN', 'आठ'],
  ] as [Language, string][])('still reads the plain count %s "%s"', (language, amount) => {
    const text = sentence[language](amount);
    expect(parseNagpur(text, language).claims[0]!.quantity).toBe(8);
    expect(nagpur(submitReadback(createDemoHandover(language), text, { language })).status).toBe(
      'agreement',
    );
  });

  it('does not treat ordinary words as glued or misspelt numbers', () => {
    for (const text of ['दोबारा चेक करके आठ', 'पुलिस आठ', 'ऑफिस आठ', 'एकूण आठ', 'अनेक आठ'])
      expect(readQuantity(text)).toEqual({ quantity: 8, issues: [] });
  });

  const modelInput = (language: Language, text: string) => ({
    text,
    role: 'incoming' as const,
    language,
    utteranceId: 'review-quantity',
    items: createDemoHandover(language).items,
  });
  const modelOutput = (text: string, quantityQuote: string, object: string) => ({
    claims: [
      {
        itemIds: ['NAGPUR'],
        quantity: 8,
        uncertainFields: [],
        evidenceQuote: text,
        fieldEvidence: { object, quantity: quantityQuote },
      },
    ],
    issues: [],
    limitations: [],
  });

  it.each([
    ['mr-IN', 'एकशे आठ', 'आठ', 'नागपूर'],
    ['mr-IN', 'आठ शे', 'आठ', 'नागपूर'],
    ['hi-IN', 'आठ गुना', 'आठ', 'नागपुर'],
    ['hi-IN', 'चालिस आठ', 'आठ', 'नागपुर'],
    ['hi-IN', 'अट्ठाइस 8', '8', 'नागपुर'],
    ['en-IN', 'eight score', 'eight', 'Nagpur'],
    ['en-IN', 'eight pairs of', 'eight', 'Nagpur'],
    ['en-IN', 'eight k', 'eight', 'Nagpur'],
  ] as [Language, string, string, string][])(
    'model quantity evidence for %s "%s" cannot claim 8',
    (language, amount, quote, object) => {
      const text = sentence[language](amount);
      expect(() =>
        validateModelOutput(modelOutput(text, quote, object), modelInput(language, text)),
      ).toThrow(/quantity/);
    },
  );

  it('model quantity evidence for a plain count is still accepted', () => {
    const text = sentence['hi-IN']('आठ');
    expect(
      validateModelOutput(modelOutput(text, 'आठ', 'नागपुर'), modelInput('hi-IN', text)).claims[0]!
        .quantity,
    ).toBe(8);
  });
});

const board = (owner: string | null) =>
  createHandover({
    id: 'review-owner',
    outgoingName: 'Asha',
    incomingName: 'Ravi',
    items: [
      {
        id: 'BLUE',
        label: 'Blue stock',
        aliases: ['blue', 'ब्लू'],
        quantity: 12,
        unit: 'carton',
        action: 'pack',
        notBefore: null,
        condition: null,
        owner,
      },
    ],
  });
const read = (owner: string | null, text: string, language: Language) =>
  compareHandover(submitReadback(board(owner), text, { language, scopeItemIds: ['BLUE'] }))[0]!;
const heard = (owner: string | null, text: string, language: Language) => {
  const parsed = parseTranscript({
    text,
    role: 'incoming',
    language,
    items: board(owner).items,
    scopeItemIds: ['BLUE'],
  });
  return {
    owners: parsed.claims.map((claim) => claim.owner),
    uncertain: parsed.claims.map((claim) => claim.uncertainFields.includes('owner')),
    codes: parsed.issues.map((issue) => issue.code),
  };
};

describe('owner is the name the clause states, or an uncertainty', () => {
  it.each([
    ['hi-IN', 'रवि के बजाय सुरेश बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'रवि की जगह सुरेश बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'रवि का भाई बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'रवि और सुरेश बारह ब्लू कार्टन पैक करेंगे।'],
    ['hi-IN', 'रवि को बताना सुरेश बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'रवि छुट्टी पर है तो सुरेश बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'रवि के बारह ब्लू कार्टन पैक करेगा।'],
    ['mr-IN', 'रवि ऐवजी सुरेश बारा ब्लू कार्टन पॅक करेल.'],
    ['mr-IN', 'रवि आणि सुरेश बारा ब्लू कार्टन पॅक करतील.'],
    ['mr-IN', 'रवि चा भाऊ बारा ब्लू कार्टन पॅक करेल.'],
    ['en-IN', 'Suresh will pack twelve blue cartons assigned to Ravi.'],
    ['en-IN', 'I will pack twelve blue cartons previously assigned to Ravi.'],
    ['en-IN', 'I will pack twelve blue cartons assigned to Ravi Shastri.'],
    ['en-IN', 'Pack twelve blue cartons assigned to Ravi and Suresh.'],
    ['en-IN', 'Pack twelve blue cartons; owner is Ravi or Suresh.'],
    ['en-IN', 'ravi kumar will pack twelve blue cartons.'],
  ] as [Language, string][])(
    '%s "%s" never agrees with planned owner रवि/Ravi',
    (language, text) => {
      const planned = language === 'en-IN' ? 'Ravi' : 'रवि';
      const result = read(planned, text, language);
      expect(result.status).not.toBe('agreement');
      expect(heard(planned, text, language).owners).not.toContain(planned);
    },
  );

  it.each([
    ['hi-IN', 'रवि के बजाय सुरेश बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'रवि का भाई बारह ब्लू कार्टन पैक करेगा।'],
    ['mr-IN', 'रवि ऐवजी सुरेश बारा ब्लू कार्टन पॅक करेल.'],
    ['en-IN', 'Suresh will pack twelve blue cartons assigned to Ravi.'],
    ['en-IN', 'I will pack twelve blue cartons previously assigned to Ravi.'],
  ] as [Language, string][])('raises AMBIGUOUS_OWNER for %s "%s"', (language, text) => {
    const result = heard('रवि', text, language);
    expect(result.codes).toContain('AMBIGUOUS_OWNER');
    expect(result.uncertain).toContain(true);
    expect(result.owners.filter(Boolean)).toEqual([]);
  });

  it.each([
    'हम बारह ब्लू कार्टन पैक करेंगे।',
    'ठीक है बारह ब्लू कार्टन पैक करेंगे।',
    'हाँ बारह ब्लू कार्टन पैक करेंगे।',
    'जरूर बारह ब्लू कार्टन पैक करेंगे।',
    'दोपहर में बारह ब्लू कार्टन पैक करेंगे।',
    'पूरे बारह ब्लू कार्टन पैक करेंगे।',
    'जी बारह ब्लू कार्टन पैक करेंगे।',
    'सर बारह ब्लू कार्टन पैक करेंगे।',
    'पहले बारह ब्लू कार्टन पैक करेंगे।',
  ])('a discourse word before a plural -ेंगे verb is not an owner: %s', (text) => {
    const result = heard(null, text, 'hi-IN');
    expect(result.owners.filter(Boolean)).toEqual([]);
    expect(read(null, text, 'hi-IN').status).toBe('agreement');
  });

  it('keeps the demo dispatch sentence with जी and -ेंगे free of an invented owner', () => {
    const text = 'जी आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजेंगे।';
    const parsed = parseTranscript({
      text,
      role: 'incoming',
      language: 'hi-IN',
      items: createDemoHandover('hi-IN').items,
    });
    expect(parsed.claims[0]!.owner).toBeUndefined();
    expect(
      nagpur(submitReadback(createDemoHandover('hi-IN'), text, { language: 'hi-IN' })).status,
    ).toBe('agreement');
  });

  it.each([
    ['en-IN', 'Ravi Kumar will pack twelve blue cartons.'],
    ['en-IN', 'Suresh Kumar will pack twelve blue cartons.'],
    ['en-IN', 'ravi kumar will pack twelve blue cartons.'],
    ['en-IN', 'Pack twelve blue cartons assigned to Ravi Shastri.'],
    ['en-IN', 'Pack twelve blue cartons assigned to Ravi.'],
    ['hi-IN', 'रवि कुमार बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'सुरेश बारह ब्लू कार्टन पैक करेंगे।'],
  ] as [Language, string][])(
    'hears the same owner whatever any plan says: %s "%s"',
    (language, text) => {
      const results = [
        null,
        'Ravi',
        'Kumar',
        'Ravi Kumar',
        'Suresh Kumar',
        'Ravi Shastri',
        'रवि',
      ].map((owner) => heard(owner, text, language));
      for (const result of results) {
        expect(result.owners).toEqual(results[0]!.owners);
        expect(result.uncertain).toEqual(results[0]!.uncertain);
      }
    },
  );

  it('takes a capitalised multi-word name whole', () => {
    expect(heard(null, 'Ravi Kumar will pack twelve blue cartons.', 'en-IN').owners).toEqual([
      'Ravi Kumar',
    ]);
    expect(read('Ravi', 'Ravi Kumar will pack twelve blue cartons.', 'en-IN').status).toBe(
      'contradiction',
    );
    expect(read('Kumar', 'Suresh Kumar will pack twelve blue cartons.', 'en-IN').status).toBe(
      'contradiction',
    );
    expect(read('Ravi', 'Pack twelve blue cartons assigned to Ravi Shastri.', 'en-IN').status).toBe(
      'contradiction',
    );
    expect(read('Ravi Kumar', 'Ravi Kumar will pack twelve blue cartons.', 'en-IN').status).toBe(
      'agreement',
    );
  });

  it('still accepts a plainly stated planned owner', () => {
    expect(read('Ravi', 'Ravi will pack twelve blue cartons.', 'en-IN').status).toBe('agreement');
    expect(read('Ravi', 'Pack twelve blue cartons assigned to Ravi.', 'en-IN').status).toBe(
      'agreement',
    );
    expect(read('रवि', 'रवि बारह ब्लू कार्टन पैक करेगा।', 'hi-IN').status).toBe('agreement');
    expect(read('रवि', 'रवि दोपहर में बारह ब्लू कार्टन पैक करेगा।', 'hi-IN').status).toBe('agreement');
    expect(read('सुरेश', 'सुरेश बारा ब्लू कार्टन पॅक करेल.', 'mr-IN').status).toBe('agreement');
  });
});
