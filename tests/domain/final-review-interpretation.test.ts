import { describe, expect, it } from 'vitest';
import {
  clarificationField,
  compareHandover,
  confirmItem,
  createDemoHandover,
  createHandover,
  needsFullRestatement,
  parseTranscript,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';
import { currentQuestion } from '../../src/lib/language';

/**
 * Final-review findings on rules v4: a second clock phrase read as the quantity, short
 * answers that erased unexplained wording, inflected competing verbs, inverted "until",
 * transitive "leave", questions and delegation read as intent, and smaller gaps.
 * Not safely understood → uncertainty; nothing is ever taken from the plan.
 */

let clock = Date.parse('2030-01-01T10:00:00.000Z');
const at = () => new Date((clock += 1_000)).toISOString();
const result = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!;
const confirmable = (state: HandoverState, id: string) => {
  try {
    confirmItem(state, id);
    return true;
  } catch {
    return false;
  }
};
const languageOf = (text: string): Language =>
  /[\u0900-\u097F]/u.test(text)
    ? /पाठव|मी |थांब|नंतर|वाजता|देईन|टाकेन/u.test(text)
      ? 'mr-IN'
      : 'hi-IN'
    : 'en-IN';
const demo = (language: Language) => ({
  ...createDemoHandover(language),
  createdAt: '2029-12-31T00:00:00.000Z',
});
/** A custom board: P1 dispatch on manager approval (owner Meena); B1 pack after 10 AM. */
const custom = (language: Language = 'en-IN') => ({
  ...createHandover({
    id: 'custom',
    outgoingName: 'Asha',
    incomingName: 'Ravi',
    language,
    items: [
      {
        id: 'P1',
        label: 'Pune cartons',
        aliases: ['Pune', 'पुणे'],
        quantity: 5,
        unit: 'carton',
        action: 'dispatch',
        notBefore: null,
        condition: 'manager approval',
        owner: 'Meena',
      },
      {
        id: 'B1',
        label: 'Blue cartons',
        aliases: ['blue', 'ब्लू'],
        quantity: 12,
        unit: 'carton',
        action: 'pack',
        notBefore: '10:00',
        condition: null,
        owner: 'Ravi',
      },
    ],
  }),
  createdAt: '2029-12-31T00:00:00.000Z',
});
type Board = (language: Language) => HandoverState;

function readback(text: string, board: Board = demo) {
  const language = languageOf(text);
  return submitReadback(board(language), text, { language, at: at() });
}
/** Answer the guide's current question for one item, as the app does. */
function answer(state: HandoverState, id: string, text: string) {
  return submitReadback(state, text, {
    scopeItemIds: [id],
    answerField: clarificationField(result(state, id)),
    language: languageOf(text),
    at: at(),
  });
}
const parse = (text: string, board: Board = demo) => {
  const language = languageOf(text);
  return parseTranscript({ text, role: 'incoming', language, items: board(language).items });
};
const codes = (state: HandoverState, id: string) =>
  state.readbacks[id]!.issues.map((issue) => issue.code);
const claim = (state: HandoverState, id: string) => state.readbacks[id]!.claims[0]!;
/** Not agreement, not confirmable. */
const unresolved = (state: HandoverState, id: string) => {
  expect(result(state, id).status).not.toBe('agreement');
  expect(confirmable(state, id)).toBe(false);
};

describe('F1: a second clock phrase never becomes the quantity', () => {
  it.each([
    'मैं नागपुर पार्सल दोपहर तीन बजे के बाद शाम आठ बजे भेजूंगा।',
    'मी नागपूर पार्सल दुपारी तीन नंतर आठ वाजता पाठवेन.',
    'I will send the 8 PM Nagpur parcels after 3 PM.',
    'I will send Nagpur parcels after 3 PM 8 PM.',
    'I will send Nagpur parcels after 3 PM for 8.',
    'I will send item 8 Nagpur parcels after 3 PM.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    const nagpur = claim(state, 'NAGPUR');
    expect(nagpur.quantity === 8 && !nagpur.uncertainFields.includes('quantity')).toBe(false);
    expect(nagpur.uncertainFields.length).toBeGreaterThan(0);
  });

  it('reports a second time as its own issue', () => {
    expect(codes(readback('I will send Nagpur parcels after 3 PM 8 PM.'), 'NAGPUR')).toContain(
      'MULTIPLE_TIMES',
    );
  });

  it('keeps the period word with the time it was said for', () => {
    // "सुबह तीन बजे के बाद आठ": सुबह belongs to three; eight is the count.
    const state = readback('मैं सुबह तीन बजे के बाद आठ नागपुर पार्सल भेजूंगा।');
    expect(claim(state, 'NAGPUR')).toMatchObject({ quantity: 8, notBefore: '03:00' });
    expect(result(state, 'NAGPUR').status).toBe('contradiction');
  });
});

describe('F2: a time, limit, duration or place number never completes the quantity', () => {
  it.each([
    'I will send Nagpur parcels before 8 PM.',
    'I will send Nagpur parcels by 8 PM.',
    'I will send Nagpur parcels in 8 hours.',
    'I will send Nagpur parcels from bay 8.',
    'I will send Nagpur parcels to 8 shops.',
    'मैं नागपुर पार्सल 8 बजे तक भेजूंगा।',
    'मी नागपूर पार्सल आठ दिवसांत पाठवेन.',
  ])('%s, then answering the time', (text) => {
    let state = readback(text);
    expect(claim(state, 'NAGPUR').quantity).toBeUndefined();
    for (const reply of ['after 3 PM', 'send', 'after 3 PM']) {
      state = answer(state, 'NAGPUR', reply);
      unresolved(state, 'NAGPUR');
      expect(claim(state, 'NAGPUR').quantity).toBeUndefined();
    }
  });

  it('never keeps "for 1 hour" as quantity 1 while the time limit disappears', () => {
    let state = readback('I will hold J1 for 1 hour.');
    expect(claim(state, 'J1').quantity).toBeUndefined();
    expect(codes(state, 'J1')).toContain('UNSUPPORTED_DURATION');
    for (const reply of ['hold', 'parcel', 'until the address is confirmed']) {
      state = answer(state, 'J1', reply);
      unresolved(state, 'J1');
    }
    expect(claim(state, 'J1').quantity).toBeUndefined();
  });

  it('still reads a count said next to its item or unit', () => {
    for (const text of [
      'I will send eight Nagpur parcels after 3 PM.',
      'I will send 8 of the Nagpur parcels after 3 PM.',
      'मैं नागपुर के आठ पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
    ])
      expect(result(readback(text), 'NAGPUR').status).toBe('agreement');
  });
});

describe('F3: a short answer never erases wording the rules could not account for', () => {
  it.each([
    'I will send eight Nagpur parcels after 3 PM to Pune.',
    'I will send eight Nagpur parcels after 3 PM on Monday.',
    'I will send eight Nagpur parcels after 3 PM next month.',
    'I will send eight Nagpur parcels after 3 PM to the wrong address.',
    'I will send eight Nagpur parcels after 3 PM each day.',
    'I will return eight Nagpur parcels after 3 PM.',
    'I will destroy eight Nagpur parcels after 3 PM.',
    'I will unpack eight Nagpur parcels after 3 PM.',
    'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद पुणे भेजूंगा।',
    'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद वापस भेजूंगा।',
    // Decision: a negation, completed work or a question also needs a full restatement.
    'I will not send eight Nagpur parcels after 3 PM.',
    'I will not send eight Nagpur parcels.',
    'I already sent eight Nagpur parcels after 3 PM.',
    'Should I send eight Nagpur parcels after 3 PM?',
  ])('%s, then "send"', (text) => {
    let state = readback(text);
    unresolved(state, 'NAGPUR');
    state = answer(state, 'NAGPUR', 'send');
    unresolved(state, 'NAGPUR');
    // The answer stands alone: the earlier count and time are never inherited.
    expect(claim(state, 'NAGPUR').basis).toBeUndefined();
    expect(claim(state, 'NAGPUR').quantity).toBeUndefined();
    expect(claim(state, 'NAGPUR').notBefore).toBeUndefined();
  });

  it('asks for the whole item again instead of one word', () => {
    const state = readback('I will send eight Nagpur parcels after 3 PM to Pune.');
    expect(needsFullRestatement(state, 'NAGPUR')).toBe(true);
    const nagpur = state.items.find((item) => item.id === 'NAGPUR')!;
    for (const language of ['en-IN', 'hi-IN', 'mr-IN'] as Language[]) {
      const question = currentQuestion(state, nagpur, result(state, 'NAGPUR'), language);
      expect(question).toMatch(/whole instruction|पूरा निर्देश|संपूर्ण सूचना/u);
    }
    // A full restatement resolves it.
    const restated = answer(state, 'NAGPUR', 'I will send eight Nagpur parcels after 3 PM.');
    expect(result(restated, 'NAGPUR').status).toBe('agreement');
  });

  it('does not let "8" clear "in two batches"', () => {
    let state = readback('I will send eight Nagpur parcels after 3 PM in two batches.');
    state = answer(state, 'NAGPUR', '8');
    unresolved(state, 'NAGPUR');
  });

  it('does not let a restated prerequisite clear extra words inside it', () => {
    let state = readback('I will hold one parcel J1 until the address is confirmed in the truck.');
    unresolved(state, 'J1');
    state = answer(state, 'J1', 'until the address is confirmed');
    unresolved(state, 'J1');
  });

  it('still completes a plain omission from a short answer', () => {
    let state = readback('I will send Nagpur parcels after 3 PM.');
    state = answer(state, 'NAGPUR', '8');
    expect(result(state, 'NAGPUR').status).toBe('agreement');
  });
});

describe('F4: inflected competing verbs compete', () => {
  it.each([
    'I will keep sending two Joshi parcels until the address is confirmed.',
    'I will keep shipping two Joshi parcels until the address is confirmed.',
    'I will keep releasing two Joshi parcels until the address is confirmed.',
    'I will keep dispatching two Joshi parcels until the address is confirmed.',
    'I will keep packing two Joshi parcels until the address is confirmed.',
    'I will keep collecting two Joshi parcels until the address is confirmed.',
    'I will hold shipping two Joshi parcels until the address is confirmed.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'J1');
    expect(codes(state, 'J1')).toContain('COMPETING_ACTIONS');
  });

  it.each([
    'I will be holding and then send eight Nagpur parcels after 3 PM.',
    'I will send eight Nagpur parcels after 3 PM retaining them.',
    'I will send eight Nagpur parcels for packing after 3 PM.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('COMPETING_ACTIONS');
  });
});

describe('F5: until / till / unless on a non-hold action is never a release time or prerequisite', () => {
  it.each([
    'I will send eight Nagpur parcels unless it is past 3 PM.',
    'I will send eight Nagpur parcels unless it is after 3 PM.',
    'I will send eight Nagpur parcels until it is past 3 PM.',
    'I will send eight Nagpur parcels until after 3 PM.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('INVERTED_GATE');
  });

  it.each([
    'Meena will send five Pune cartons unless the manager approves.',
    'Meena will send five Pune cartons until the manager approves.',
  ])('custom board: %s', (text) => {
    unresolved(readback(text, custom), 'P1');
  });

  it.each([
    'unless the manager approves',
    'until the manager approves',
    'till the manager approves',
  ])('short answer to the prerequisite question: %s', (reply) => {
    let state = readback('Meena will send five Pune cartons.', custom);
    expect(clarificationField(result(state, 'P1'))).toBe('condition');
    state = answer(state, 'P1', reply);
    unresolved(state, 'P1');
    expect(codes(state, 'P1')).toContain('INVERTED_GATE');
  });

  it.each(['until 3 PM', 'till 3 PM'])('short answer to the time question: %s', (reply) => {
    let state = readback('I will send eight Nagpur parcels.');
    expect(clarificationField(result(state, 'NAGPUR'))).toBe('notBefore');
    state = answer(state, 'NAGPUR', reply);
    unresolved(state, 'NAGPUR');
    expect(claim(state, 'NAGPUR').notBefore).toBeUndefined();
  });

  it('keeps the supported forms', () => {
    expect(
      result(readback('Meena will send five Pune cartons once the manager approves.', custom), 'P1')
        .status,
    ).toBe('agreement');
    let state = readback('Meena will send five Pune cartons.', custom);
    state = answer(state, 'P1', 'once the manager approves');
    expect(result(state, 'P1').status).toBe('agreement');
  });
});

describe('F6: "leave" is a dispatch only when the item itself leaves', () => {
  it.each([
    'I will leave eight Nagpur parcels here after 3 PM.',
    'I will leave eight Nagpur parcels as they are after 3 PM.',
  ])('%s', (text) => {
    unresolved(readback(text), 'NAGPUR');
  });

  it.each(['leave', 'leave them', 'leave it'])('short answer "%s"', (reply) => {
    let state = readback('I will hold eight Nagpur parcels after 3 PM.');
    expect(clarificationField(result(state, 'NAGPUR'))).toBe('action');
    state = answer(state, 'NAGPUR', reply);
    unresolved(state, 'NAGPUR');
    expect(claim(state, 'NAGPUR').action).toBeUndefined();
  });

  it('keeps "the parcels will leave after 3 PM"', () => {
    expect(
      result(readback('The eight Nagpur parcels will leave after 3 PM.'), 'NAGPUR').status,
    ).toBe('agreement');
  });

  it.each([
    'मी आठ नागपूर पार्सल दुपारी तीन नंतर सोडून देईन.',
    'मी आठ नागपूर पार्सल दुपारी तीन नंतर सोडून टाकेन.',
  ])('Marathi सोडून देणे / टाकणे is not a dispatch: %s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(claim(state, 'NAGPUR').action).toBeUndefined();
  });
});

describe('F7: a particle that changes the action stays unexplained', () => {
  it.each([
    'I will send back eight Nagpur parcels after 3 PM.',
    'I will ship back eight Nagpur parcels after 3 PM.',
    'I will release eight Nagpur parcels back after 3 PM.',
    'I will send eight Nagpur parcels aside after 3 PM.',
    'I will send for eight Nagpur parcels after 3 PM.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('UNEXPLAINED_WORDING');
  });

  it('keeps "send out" and "pick up"', () => {
    expect(
      result(readback('I will send out eight Nagpur parcels after 3 PM.'), 'NAGPUR').status,
    ).toBe('agreement');
  });
});

describe('F8: "more" counts are qualified', () => {
  it.each([
    'मैं आठ और नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
    'मैं और आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
    'मी आणखी आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन.',
    'मी आठ अजून नागपूर पार्सल दुपारी तीन नंतर पाठवेन.',
    'I will send eight more Nagpur parcels after 3 PM.',
    'I will send another 8 Nagpur parcels after 3 PM.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('QUALIFIED_QUANTITY');
  });
});

describe('F9: a question is never intent', () => {
  it.each([
    'Will I send eight Nagpur parcels after 3 PM?',
    'I will send eight Nagpur parcels after 3 PM?',
    'Am I going to send eight Nagpur parcels after 3 PM',
    'Is it ok to send eight Nagpur parcels after 3 PM',
    'मी आठ नागपूर पार्सल दुपारी तीन नंतर पाठवेन का?',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('QUESTION_NOT_INTENT');
  });

  it.each([
    'Am I to hold two Joshi parcels until the address is confirmed?',
    'Will I hold two Joshi parcels until the address is confirmed?',
    'मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवेन का?',
  ])('%s', (text) => {
    unresolved(readback(text), 'J1');
  });

  it('keeps the question mark in the clause evidence', () => {
    const parsed = parse('I will send eight Nagpur parcels after 3 PM?');
    expect(parsed.claims[0]!.evidence.text).toBe('I will send eight Nagpur parcels after 3 PM?');
  });

  it.each([
    ['I will send Nagpur parcels after 3 PM.', 'NAGPUR', ['8?', 'is it 8?']],
    ['I will send eight Nagpur parcels.', 'NAGPUR', ['3 PM?']],
    ['I will send eight Nagpur parcels after 3 PM.', 'J1', []],
  ] as [string, string, string[]][])('short answers to %s', (first, id, replies) => {
    for (const reply of replies) {
      const state = answer(readback(first), id, reply);
      unresolved(state, id);
      expect(codes(state, id)).toContain('QUESTION_NOT_INTENT');
    }
  });

  it('a questioned action, prerequisite or owner answer stays open', () => {
    let state = readback('I will hold eight Nagpur parcels after 3 PM.');
    unresolved(answer(state, 'NAGPUR', 'send?'), 'NAGPUR');
    state = readback(
      'I will send eight Nagpur parcels after 3 PM. I will hold one J1 parcel. I will hold J2 until the address is confirmed.',
    );
    expect(clarificationField(result(state, 'J1'))).toBe('condition');
    unresolved(answer(state, 'J1', 'address confirmed?'), 'J1');
    state = readback('I will send five Pune cartons once the manager approves.', custom);
    expect(clarificationField(result(state, 'P1'))).toBe('owner');
    unresolved(answer(state, 'P1', 'Meena?'), 'P1');
  });
});

describe('F10: an instruction to someone else is not the worker’s own commitment', () => {
  it.each([
    'You will send eight Nagpur parcels after 3 PM.',
    'He will send eight Nagpur parcels after 3 PM.',
    'They will send eight Nagpur parcels after 3 PM.',
    'Please send eight Nagpur parcels after 3 PM.',
    'Send eight Nagpur parcels after 3 PM.',
    'आप आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजेंगे।',
    'तुम्ही आठ नागपूर पार्सल दुपारी तीन नंतर पाठवा.',
  ])('%s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('ADDRESSED_TO_OTHER');
  });

  it('keeps first-person read-backs, a shared subject and an explicit owner', () => {
    expect(
      result(
        readback(
          "I'll send eight Nagpur parcels after 3 p.m. and hold two Joshi parcels until the address is confirmed.",
        ),
        'J1',
      ).status,
    ).toBe('agreement');
    const owned = readback('Pack twelve blue cartons after 10 AM assigned to Ravi.', custom);
    expect(codes(owned, 'B1')).not.toContain('ADDRESSED_TO_OTHER');
    expect(result(owned, 'B1').status).toBe('agreement');
  });
});

describe('F11: smaller gaps', () => {
  it.each([
    'I will send eight Nagpur parcels after 3 pm am.',
    'I will send eight Nagpur parcels after 3 p.m. a.m.',
  ])('two periods for one time: %s', (text) => {
    const state = readback(text);
    unresolved(state, 'NAGPUR');
    expect(codes(state, 'NAGPUR')).toContain('AMBIGUOUS_TIME');
  });

  it.each(['parcels of boxes', 'parcel boxes'])('two units in one answer: %s', (reply) => {
    let state = readback('I will send eight Nagpur after 3 PM.');
    expect(clarificationField(result(state, 'NAGPUR'))).toBe('unit');
    state = answer(state, 'NAGPUR', reply);
    unresolved(state, 'NAGPUR');
  });

  it('a number cut off by a dash is not a count', () => {
    const state = answer(readback('I will send Nagpur parcels after 3 PM.'), 'NAGPUR', '8-');
    unresolved(state, 'NAGPUR');
  });

  it('a statement ending with "and" leaves the prerequisite open', () => {
    unresolved(readback('I will hold two Joshi parcels until the address is confirmed and.'), 'J1');
  });
});

describe('false alarms fixed', () => {
  it.each(['9, sorry, 8', 'no, eight', 'eight'])('quantity answer "%s"', (reply) => {
    const state = answer(readback('I will send Nagpur parcels after 3 PM.'), 'NAGPUR', reply);
    expect(result(state, 'NAGPUR').status).toBe('agreement');
    expect(claim(state, 'NAGPUR').quantity).toBe(8);
  });
});

describe('DEMO phrasings keep behaving as documented', () => {
  it.each([
    [
      'en-IN',
      'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.',
    ],
    [
      'en-IN',
      'I will hold two Joshi parcels until the address is confirmed. I will send eight Nagpur parcels once it is past 3 PM.',
    ],
    [
      'hi-IN',
      'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा। मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोक कर रखूंगा।',
    ],
    [
      'mr-IN',
      'मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवेन. मी दोन जोशी पार्सल जोपर्यंत पत्त्याची पुष्टी होत नाही तोपर्यंत थांबवेन.',
    ],
  ] as [Language, string][])('%s: %s', (language, text) => {
    const state = submitReadback(demo(language), text, { language, at: at() });
    for (const id of ['NAGPUR', 'J1', 'J2']) expect(result(state, id).status).toBe('agreement');
  });

  it('the missed hold still contradicts', () => {
    const state = readback('I will send all ten parcels after 3 PM.');
    expect(result(state, 'NAGPUR').status).toBe('agreement');
    expect(result(state, 'J1').status).toBe('contradiction');
  });
});
