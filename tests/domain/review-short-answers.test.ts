import { describe, expect, it } from 'vitest';
import {
  clarificationAttempts,
  clarificationField,
  compareHandover,
  confirmItem,
  createDemoHandover,
  createHandover,
  restoreHandover,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';

const result = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!;

let clock = Date.parse('2030-01-01T10:00:00.000Z');
const at = () => new Date((clock += 1_000)).toISOString();

function board(firstReadback: string, language: Language = 'en-IN') {
  const state = createDemoHandover(language);
  return submitReadback({ ...state, createdAt: '2029-12-31T00:00:00.000Z' }, firstReadback, {
    at: at(),
  });
}
function answer(state: HandoverState, id: string, text: string) {
  return submitReadback(state, text, {
    scopeItemIds: [id],
    answerField: clarificationField(result(state, id)),
    at: at(),
  });
}
const claim = (state: HandoverState, id: string) => state.readbacks[id]!.claims[0];
const codes = (state: HandoverState, id: string) =>
  state.readbacks[id]!.issues.map((issue) => issue.code);
const confirmable = (state: HandoverState, id: string) => {
  try {
    confirmItem(state, id);
    return true;
  } catch {
    return false;
  }
};

const MISSING_QUANTITY =
  'I will send Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';
const MISSING_TIME =
  'I will send eight Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.';
const MISSING_CONDITION =
  'I will send eight Nagpur parcels after 3 PM. I will hold one J1 parcel. I will hold J2 until the address is confirmed.';
const MISSING_CONDITION_HI =
  'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा। मैं एक J1 पार्सल रोकूंगा। मैं J2 पता कन्फर्म होने तक रोकूंगा।';

describe('a negated or already-satisfied prerequisite answer never becomes "address confirmed"', () => {
  it.each([
    ["address doesn't need to be confirmed", 'en-IN'],
    ["address isn't confirmed", 'en-IN'],
    ["address needn't be confirmed", 'en-IN'],
    ['address confirmation is optional', 'en-IN'],
    ['address confirmed is no longer required', 'en-IN'],
    ['address hardly needs confirming', 'en-IN'],
    ['address confirmed, no', 'en-IN'],
    ['address confirmed by anyone', 'en-IN'],
    ['address has been confirmed', 'en-IN'],
    ['पता कन्फर्म हो चुका है', 'hi-IN'],
    ['पता पहले ही कन्फर्म है', 'hi-IN'],
    ['पत्त्याची पुष्टी झाली आहे', 'mr-IN'],
  ] as const)('"%s" stays unresolved', (text, language) => {
    const before = board(language === 'en-IN' ? MISSING_CONDITION : MISSING_CONDITION_HI, language);
    expect(clarificationField(result(before, 'J1'))).toBe('condition');
    const after = answer(before, 'J1', text);
    expect(result(after, 'J1').status).not.toBe('agreement');
    expect(
      claim(after, 'J1')?.condition === 'address confirmed' &&
        !claim(after, 'J1')!.uncertainFields.includes('condition'),
    ).toBe(false);
    expect(confirmable(after, 'J1')).toBe(false);
  });

  it.each(['address confirmed', 'address confirmation', 'पता कन्फर्म', 'address must be confirmed'])(
    'a plain value-only prerequisite "%s" is still accepted',
    (text) => {
      const after = answer(board(MISSING_CONDITION), 'J1', text);
      expect(claim(after, 'J1')).toMatchObject({ action: 'hold', condition: 'address confirmed' });
      expect(result(after, 'J1').status).toBe('agreement');
    },
  );
});

describe('a time is never read as a count, nor a count as a time', () => {
  it.each(['8 PM', '8 pm', "8 o'clock", '8 बजे', '8 वाजता', 'morning 8', '8:30'])(
    'a clock answer "%s" to "How many?" does not become the quantity',
    (text) => {
      const before = board(MISSING_QUANTITY);
      expect(clarificationField(result(before, 'NAGPUR'))).toBe('quantity');
      const after = answer(before, 'NAGPUR', text);
      expect(claim(after, 'NAGPUR')?.quantity).toBeUndefined();
      expect(result(after, 'NAGPUR').status).not.toBe('agreement');
      expect(confirmable(after, 'NAGPUR')).toBe(false);
    },
  );

  it.each(['20 parcels', '18 parcels', '20', '23', '15', 'twenty parcels'])(
    'a count answer "%s" to "At what time?" does not become the time',
    (text) => {
      const before = board(MISSING_TIME);
      expect(clarificationField(result(before, 'NAGPUR'))).toBe('notBefore');
      const after = answer(before, 'NAGPUR', text);
      expect(claim(after, 'NAGPUR')?.notBefore).toBeUndefined();
      expect(result(after, 'NAGPUR').status).not.toBe('agreement');
      expect(confirmable(after, 'NAGPUR')).toBe(false);
    },
  );

  it('a bare number to the time question is reported as an ambiguous time', () => {
    const after = answer(board(MISSING_TIME), 'NAGPUR', '20');
    expect(codes(after, 'NAGPUR')).toContain('AMBIGUOUS_TIME');
    expect(claim(after, 'NAGPUR')).toMatchObject({ quantity: 8, action: 'dispatch' });
  });

  it.each(['3 PM', '15:00', 'at 3 PM', 'afternoon 3'])(
    '"%s" still answers the time question',
    (text) => {
      const after = answer(board(MISSING_TIME), 'NAGPUR', text);
      expect(claim(after, 'NAGPUR')).toMatchObject({ notBefore: '15:00', quantity: 8 });
      expect(result(after, 'NAGPUR').status).toBe('agreement');
    },
  );
});

describe('a full statement replaces the earlier read-back instead of inheriting from it', () => {
  it.each(['send 8 now', 'send 8 immediately', 'send eight right away'])(
    '"%s" never inherits the earlier release time',
    (text) => {
      const after = answer(board(MISSING_QUANTITY), 'NAGPUR', text);
      expect(claim(after, 'NAGPUR')?.notBefore).toBeUndefined();
      expect(claim(after, 'NAGPUR')?.basis).toBeUndefined();
      expect(result(after, 'NAGPUR').status).not.toBe('agreement');
    },
  );

  it('changing the action keeps an inherited prerequisite open', () => {
    const plan = createHandover({
      id: 'h-hold',
      outgoingName: 'Asha',
      incomingName: 'Ravi',
      items: [
        {
          id: 'J7',
          label: 'Parcel J7',
          aliases: ['J7'],
          quantity: 1,
          unit: 'parcel',
          action: 'hold',
          notBefore: null,
          condition: 'address confirmed',
          owner: null,
        },
      ],
    });
    const before = submitReadback(
      { ...plan, createdAt: '2029-12-31T00:00:00.000Z' },
      'I will send one parcel J7 once the address is confirmed.',
      { at: at() },
    );
    expect(clarificationField(result(before, 'J7'))).toBe('action');
    const after = answer(before, 'J7', 'hold');
    expect(result(after, 'J7').status).not.toBe('agreement');
    expect(claim(after, 'J7')!.uncertainFields).toContain('condition');
    expect(codes(after, 'J7')).toContain('AMBIGUOUS_HOLD_CONDITION');
    const settled = answer(after, 'J7', 'until the address is confirmed');
    expect(result(settled, 'J7').status).toBe('agreement');
  });
});

describe('natural short replies keep the earlier read-back', () => {
  it.each([
    ['yes, 8', 'en-IN'],
    ['yes 8', 'en-IN'],
    ['ok, 8 parcels', 'en-IN'],
    ['eight, yes', 'en-IN'],
    ['there are 8', 'en-IN'],
    ['um 8', 'en-IN'],
    ['quantity is 8', 'en-IN'],
    ['all 8', 'en-IN'],
    ['हाँ, आठ', 'hi-IN'],
    ['हाँ आठ', 'hi-IN'],
    ['जी आठ', 'hi-IN'],
    ['आठ ही', 'hi-IN'],
    ['सभी आठ', 'hi-IN'],
    ['हो, आठ', 'mr-IN'],
    ['सगळे आठ', 'mr-IN'],
  ] as const)('"%s" answers the quantity question', (text, language) => {
    const first = {
      'en-IN': MISSING_QUANTITY,
      'hi-IN': 'मैं नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
      'mr-IN': 'मी नागपूर पार्सल दुपारी तीन नंतर पाठवेन.',
    }[language];
    const before = board(first, language);
    expect(clarificationField(result(before, 'NAGPUR'))).toBe('quantity');
    const after = answer(before, 'NAGPUR', text);
    expect(claim(after, 'NAGPUR')).toMatchObject({
      action: 'dispatch',
      quantity: 8,
      notBefore: '15:00',
    });
    expect(result(after, 'NAGPUR').status).toBe('agreement');
    // "all" in a one-item clarification never reaches another item.
    expect(after.readbacks.J1).toEqual(before.readbacks.J1);
  });

  it('a hedged count keeps the read-back but stays unresolved', () => {
    const after = answer(board(MISSING_QUANTITY), 'NAGPUR', 'I think 8');
    expect(claim(after, 'NAGPUR')).toMatchObject({ action: 'dispatch', notBefore: '15:00' });
    expect(claim(after, 'NAGPUR')!.basis).toBeDefined();
    expect(result(after, 'NAGPUR').status).not.toBe('agreement');
    expect(clarificationField(result(after, 'NAGPUR'))).toBe('quantity');
  });

  it.each(['Nagpur', 'banana', 'the thing'])(
    'an unusable reply "%s" keeps the earlier statement and asks the same detail',
    (text) => {
      const before = board(MISSING_QUANTITY);
      const after = answer(before, 'NAGPUR', text);
      expect(claim(after, 'NAGPUR')).toMatchObject({ action: 'dispatch', notBefore: '15:00' });
      expect(clarificationField(result(after, 'NAGPUR'))).toBe('quantity');
      expect(clarificationAttempts(after, 'NAGPUR').attempts).toBe(1);
    },
  );

  const ownerBoard = () => {
    const plan = createHandover({
      id: 'h-owner',
      outgoingName: 'Asha',
      incomingName: 'Ravi',
      items: [
        {
          id: 'P1',
          label: 'Pune cartons',
          aliases: ['Pune'],
          quantity: 5,
          unit: 'carton',
          action: 'dispatch',
          notBefore: null,
          condition: 'manager approval',
          owner: 'Meena',
        },
      ],
    });
    return submitReadback(
      { ...plan, createdAt: '2029-12-31T00:00:00.000Z' },
      'I will send five Pune cartons once the manager approves.',
      { at: at() },
    );
  };

  it.each(['Meena', 'Meena will do it', 'Meena is responsible', 'assigned to Meena', 'yes, Meena'])(
    'the owner answer "%s" fills only the owner',
    (text) => {
      const before = ownerBoard();
      expect(clarificationField(result(before, 'P1'))).toBe('owner');
      const after = answer(before, 'P1', text);
      expect(claim(after, 'P1')).toMatchObject({
        action: 'dispatch',
        quantity: 5,
        owner: 'Meena',
        condition: 'manager approval',
      });
      expect(result(after, 'P1').status).toBe('agreement');
    },
  );

  it('a Devanagari name answers the owner question with the spoken name, never the plan', () => {
    const after = answer(ownerBoard(), 'P1', 'मीना');
    expect(claim(after, 'P1')).toMatchObject({ action: 'dispatch', owner: 'मीना' });
    const other = answer(ownerBoard(), 'P1', 'Ravi');
    expect(claim(other, 'P1')!.owner).toBe('Ravi');
    expect(result(other, 'P1').status).toBe('contradiction');
  });

  it('an item that keeps failing escalates per item, even when the question changes', () => {
    let state = ownerBoard();
    for (const text of ['banana', 'the thing', 'hmm']) state = answer(state, 'P1', text);
    expect(clarificationAttempts(state, 'P1').attempts).toBeGreaterThanOrEqual(3);
    // A real answer resets the count.
    state = answer(state, 'P1', 'Meena');
    expect(result(state, 'P1').status).toBe('agreement');
    expect(clarificationAttempts(state, 'P1').attempts).toBe(0);
  });
});

describe('an imported short answer must complete the latest read-back of its item', () => {
  it('rejects a basis that a later read-back superseded', () => {
    let state = submitReadback(
      { ...createDemoHandover(), createdAt: '2029-12-31T00:00:00.000Z' },
      'I will send Nagpur parcels after 3 PM.',
      { at: at(), scopeItemIds: ['NAGPUR'] },
    );
    const first = state.readbacks.NAGPUR!.utteranceId;
    state = submitReadback(state, 'I will send Nagpur parcels after 1 PM.', {
      at: at(),
      scopeItemIds: ['NAGPUR'],
    });
    state = answer(state, 'NAGPUR', '8');
    expect(() => restoreHandover(JSON.parse(JSON.stringify(state)))).not.toThrow();
    const forged = JSON.parse(JSON.stringify(state)) as HandoverState;
    const id = forged.readbacks.NAGPUR!.utteranceId;
    const utterance = forged.utterances.find((entry) => entry.utteranceId === id)!;
    for (const entry of [utterance.claims[0]!, forged.readbacks.NAGPUR!.claims[0]!]) {
      entry.notBefore = '15:00';
      entry.basis = { utteranceId: first, claimId: `${first}-claim-1`, fields: ['quantity'] };
    }
    expect(() => restoreHandover(forged)).toThrow(
      expect.objectContaining({ code: 'INVALID_BACKUP' }),
    );
  });
});
