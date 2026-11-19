import { describe, expect, it } from 'vitest';
import {
  clarificationAttempts,
  clarificationField,
  compareHandover,
  confirmItem,
  createDemoHandover,
  parseTranscript,
  recordReadback,
  restoreHandover,
  reviseItem,
  submitReadback,
} from '../../src/domain';
import type { ClaimField, HandoverState, Language } from '../../src/domain';
import { clarificationQuestion, retryQuestion } from '../../src/lib/language';

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

/** Answer the question the guide currently shows for one item. */
function answer(state: HandoverState, id: string, text: string, utteranceId?: string) {
  return submitReadback(state, text, {
    scopeItemIds: [id],
    answerField: clarificationField(result(state, id)),
    at: at(),
    ...(utteranceId ? { utteranceId } : {}),
  });
}

const values = (state: HandoverState, id: string) => {
  const { evidence: _e, id: _i, basis: _b, ...claim } = state.readbacks[id]!.claims[0]!;
  return claim;
};
const codes = (state: HandoverState, id: string) =>
  state.readbacks[id]!.issues.map((issue) => issue.code);

const MISSING_QUANTITY =
  'I will send Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';
const WRONG_QUANTITY =
  'I will send ten Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';
const MISSING_TIME =
  'I will send eight Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.';
const MISSING_CONDITION =
  'I will send eight Nagpur parcels after 3 PM. I will hold one J1 parcel. I will hold J2 until the address is confirmed.';

describe('short clarification answers resolve only the asked detail', () => {
  it.each(['8', 'eight', 'आठ', '8 parcels', 'eight parcels', 'आठ पार्सल', 'only 8', 'send eight'])(
    'a quantity answer "%s" completes the worker’s own earlier statement',
    (text) => {
      const before = board(MISSING_QUANTITY);
      expect(clarificationField(result(before, 'NAGPUR'))).toBe('quantity');
      const after = answer(before, 'NAGPUR', text);
      expect(result(after, 'NAGPUR').status).toBe('agreement');
      expect(values(after, 'NAGPUR')).toMatchObject({
        action: 'dispatch',
        quantity: 8,
        unit: 'parcel',
        notBefore: '15:00',
        uncertainFields: [],
      });
      const claim = after.readbacks.NAGPUR!.claims[0]!;
      expect(claim.basis?.utteranceId).toBe(before.readbacks.NAGPUR!.utteranceId);
      expect(claim.basis?.fields).toContain('quantity');
      expect(claim.evidence.text).toBe(text);
      // The earlier statement stays visible as evidence for the inherited details.
      expect(result(after, 'NAGPUR').evidence.map((evidence) => evidence.text)).toEqual([
        'I will send Nagpur parcels after 3 PM',
        text,
      ]);
      // Other items keep their earlier read-back.
      expect(after.readbacks.J1).toEqual(before.readbacks.J1);
      expect(() => confirmItem(after, 'NAGPUR')).not.toThrow();
    },
  );

  it.each(['after 3 PM', 'at 3 PM', '3 PM', '3:00 pm', 'दोपहर 3 बजे के बाद', 'दुपारी तीन नंतर'])(
    'an explicit time answer "%s" fills only the release time',
    (text) => {
      const before = board(MISSING_TIME);
      expect(clarificationField(result(before, 'NAGPUR'))).toBe('notBefore');
      const after = answer(before, 'NAGPUR', text);
      expect(values(after, 'NAGPUR')).toMatchObject({ quantity: 8, notBefore: '15:00' });
      expect(result(after, 'NAGPUR').status).toBe('agreement');
    },
  );

  it.each(['after 3', '3 बजे के बाद', 'three', 'तीन नंतर'])(
    'a time without AM/PM ("%s") stays unresolved and is never taken from the plan',
    (text) => {
      const after = answer(board(MISSING_TIME), 'NAGPUR', text);
      expect(values(after, 'NAGPUR').notBefore).toBeUndefined();
      expect(values(after, 'NAGPUR').uncertainFields).toContain('notBefore');
      expect(codes(after, 'NAGPUR')).toContain('AMBIGUOUS_TIME');
      expect(result(after, 'NAGPUR').status).toBe('uncertainty');
      expect(() => confirmItem(after, 'NAGPUR')).toThrow();
    },
  );

  it.each([
    'until the address is confirmed',
    'only after the address is confirmed',
    'पता कन्फर्म होने तक',
    'जब तक पता कन्फर्म नहीं होता',
    'पत्त्याची पुष्टी होईपर्यंत',
  ])('a prerequisite answer "%s" fills only the condition', (text) => {
    const before = board(MISSING_CONDITION);
    expect(clarificationField(result(before, 'J1'))).toBe('condition');
    const after = answer(before, 'J1', text);
    expect(values(after, 'J1')).toMatchObject({
      action: 'hold',
      quantity: 1,
      condition: 'address confirmed',
    });
    expect(result(after, 'J1').status).toBe('agreement');
    expect(after.readbacks.J2).toEqual(before.readbacks.J2);
  });

  it('never fills a missing detail from the expected plan', () => {
    const before = board(
      'I will send Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.',
    );
    const after = answer(before, 'NAGPUR', '8');
    expect(values(after, 'NAGPUR')).toMatchObject({ action: 'dispatch', quantity: 8 });
    expect(values(after, 'NAGPUR').notBefore).toBeUndefined();
    expect(result(after, 'NAGPUR').status).toBe('omission');
    expect(clarificationField(result(after, 'NAGPUR'))).toBe('notBefore');
  });

  it('keeps a contradiction in a short answer as a contradiction', () => {
    const quantity = answer(board(WRONG_QUANTITY), 'NAGPUR', '12');
    expect(result(quantity, 'NAGPUR').status).toBe('contradiction');
    expect(result(quantity, 'NAGPUR').findings[0]).toMatchObject({
      field: 'quantity',
      status: 'contradiction',
      heard: '12',
    });
    const unit = answer(board(WRONG_QUANTITY), 'NAGPUR', '8 boxes');
    expect(result(unit, 'NAGPUR').findings).toEqual([
      expect.objectContaining({ field: 'unit', status: 'contradiction' }),
    ]);
    const time = answer(board(MISSING_TIME), 'NAGPUR', 'after 1 PM');
    expect(result(time, 'NAGPUR').findings[0]).toMatchObject({
      field: 'notBefore',
      status: 'contradiction',
    });
  });

  it('does not accept a detail that was not asked; it becomes uncertain instead', () => {
    const before = board(MISSING_QUANTITY);
    const after = answer(before, 'NAGPUR', 'after 4 PM');
    expect(values(after, 'NAGPUR').notBefore).toBeUndefined();
    expect(values(after, 'NAGPUR').quantity).toBeUndefined();
    expect(values(after, 'NAGPUR').uncertainFields).toContain('notBefore');
    expect(codes(after, 'NAGPUR')).toContain('ANSWER_FOR_OTHER_DETAIL');
    expect(result(after, 'NAGPUR').status).toBe('uncertainty');
  });

  it('a short answer without a matching question, or for a changed plan, is not completed', () => {
    const before = board(MISSING_QUANTITY);
    const unasked = submitReadback(before, '8', { scopeItemIds: ['NAGPUR'], at: at() });
    expect(unasked.readbacks.NAGPUR!.claims[0]?.basis).toBeUndefined();
    expect(result(unasked, 'NAGPUR').status).not.toBe('agreement');
    const wrongQuestion = submitReadback(before, '8', {
      scopeItemIds: ['NAGPUR'],
      answerField: 'notBefore',
      at: at(),
    });
    expect(wrongQuestion.readbacks.NAGPUR!.claims[0]?.basis).toBeUndefined();
    expect(result(wrongQuestion, 'NAGPUR').status).not.toBe('agreement');

    const revised = reviseItem(before, 'NAGPUR', { quantity: 9 }, { at: at() });
    expect(clarificationField(result(revised, 'NAGPUR'))).toBeUndefined();
    const stale = submitReadback(revised, '9', {
      scopeItemIds: ['NAGPUR'],
      answerField: 'quantity',
      at: at(),
    });
    expect(stale.readbacks.NAGPUR!.claims[0]?.basis).toBeUndefined();
    expect(result(stale, 'NAGPUR').status).not.toBe('agreement');
  });

  it('a reply naming another item is still rejected from a single-item clarification', () => {
    expect(() => answer(board(MISSING_QUANTITY), 'NAGPUR', '8 for J2')).toThrow(
      expect.objectContaining({ code: 'OUTSIDE_READBACK_SCOPE' }),
    );
  });
});

describe('bare acknowledgements never confirm or fill a detail', () => {
  it.each(['yes', 'ok', 'Okay.', 'हाँ', 'हां', 'हो', 'होय', 'ठीक है', 'no'])(
    '"%s" keeps the earlier statement and the open question',
    (text) => {
      const before = board(WRONG_QUANTITY);
      const after = answer(before, 'NAGPUR', text);
      expect(codes(after, 'NAGPUR')).toEqual(['BARE_ACKNOWLEDGEMENT']);
      expect(values(after, 'NAGPUR')).toMatchObject({ quantity: 10, notBefore: '15:00' });
      expect(after.readbacks.NAGPUR!.claims[0]!.basis?.fields).toEqual([]);
      expect(result(after, 'NAGPUR').status).toBe('contradiction');
      expect(clarificationField(result(after, 'NAGPUR'))).toBe('quantity');
      expect(() => confirmItem(after, 'NAGPUR')).toThrow();
      expect(clarificationAttempts(after, 'NAGPUR')).toEqual({ attempts: 1, bareReply: true });
    },
  );

  it('a missing detail is not filled by "yes"', () => {
    const after = answer(board(MISSING_TIME), 'NAGPUR', 'yes');
    expect(values(after, 'NAGPUR').notBefore).toBeUndefined();
    expect(result(after, 'NAGPUR').status).toBe('uncertainty');
  });

  it('a reply without the asked value ("J1 only", "send it") is reported, not accepted', () => {
    const j1 = answer(
      board('I will send eight Nagpur parcels after 3 PM. I will hold J1. I will hold J2.'),
      'J1',
      'J1 only',
    );
    expect(codes(j1, 'J1')).toEqual(['NO_ANSWER_VALUE']);
    expect(result(j1, 'J1').status).toBe('uncertainty');
    const sendIt = answer(board(MISSING_QUANTITY), 'NAGPUR', 'send it');
    expect(codes(sendIt, 'NAGPUR')).toEqual(['NO_ANSWER_VALUE']);
    expect(values(sendIt, 'NAGPUR').quantity).toBeUndefined();
  });

  it('a later real answer still works after a bare reply, and attempts are counted', () => {
    let state = board(MISSING_QUANTITY);
    for (const text of ['yes', 'हाँ', 'ok']) state = answer(state, 'NAGPUR', text);
    expect(clarificationAttempts(state, 'NAGPUR')).toEqual({ attempts: 3, bareReply: true });
    state = answer(state, 'NAGPUR', 'eight');
    expect(result(state, 'NAGPUR').status).toBe('agreement');
    expect(clarificationAttempts(state, 'NAGPUR').attempts).toBe(0);
    expect(values(state, 'NAGPUR')).toMatchObject({ quantity: 8, notBefore: '15:00' });
  });
});

describe('short answers stay grounded and auditable', () => {
  it('a chain of answers survives restore and a retry is idempotent', () => {
    let state = board(
      'I will send Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.',
    );
    const request = {
      scopeItemIds: ['NAGPUR'],
      answerField: 'quantity' as const,
      utteranceId: 'answer-quantity',
      at: at(),
    };
    state = submitReadback(state, '8', request);
    // The identical request retried after it was recorded changes nothing.
    const retried = submitReadback(state, '8', request);
    expect(retried.utterances).toHaveLength(state.utterances.length);
    expect(retried.events).toHaveLength(state.events.length);
    state = answer(state, 'NAGPUR', 'after 3 PM');
    expect(result(state, 'NAGPUR').status).toBe('agreement');
    const restored = restoreHandover(JSON.parse(JSON.stringify(state)));
    expect(compareHandover(restored)).toEqual(compareHandover(state));
    expect(() => confirmItem(restored, 'NAGPUR')).not.toThrow();
  });

  it('rejects a stored short answer whose inherited details were altered', () => {
    const state = answer(board(MISSING_QUANTITY), 'NAGPUR', '8');
    const tampered = JSON.parse(JSON.stringify(state)) as HandoverState;
    const id = tampered.readbacks.NAGPUR!.utteranceId;
    const utterance = tampered.utterances.find((entry) => entry.utteranceId === id)!;
    utterance.claims[0]!.notBefore = '09:00';
    tampered.readbacks.NAGPUR!.claims[0]!.notBefore = '09:00';
    expect(() => restoreHandover(tampered)).toThrow(
      expect.objectContaining({ code: 'INVALID_BACKUP' }),
    );
  });

  it('rejects a forged basis that does not complete the current read-back', () => {
    const before = board(MISSING_QUANTITY);
    const parsed = parseTranscript({
      text: '8',
      role: 'incoming',
      language: 'en-IN',
      items: before.items,
      scopeItemIds: ['NAGPUR'],
      answerField: 'quantity',
    });
    const forged = {
      ...parsed,
      claims: [
        {
          ...parsed.claims[0]!,
          action: 'dispatch' as const,
          notBefore: '15:00',
          unit: 'parcel',
          basis: {
            utteranceId: before.readbacks.J1!.utteranceId,
            claimId: 'not-a-claim',
            fields: ['quantity' as ClaimField],
          },
        },
      ],
    };
    expect(() => recordReadback(before, forged, { at: at() })).toThrow(
      expect.objectContaining({ code: 'INVALID_ANSWER_BASIS' }),
    );
    // answerField is only valid for a single-item targeted reply.
    expect(() =>
      recordReadback(before, { ...parsed, readbackMode: 'full', scopeItemIds: undefined }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_READBACK_SCOPE' }));
  });
});

describe('repeated questions are reworded, localized, and never reveal the expected value', () => {
  it.each(['en-IN', 'hi-IN', 'mr-IN'] as const)('%s', (language) => {
    const state = answer(board(WRONG_QUANTITY, 'en-IN'), 'NAGPUR', 'yes');
    const item = state.items.find((entry) => entry.id === 'NAGPUR')!;
    const first = clarificationQuestion(item, result(state, 'NAGPUR'), language);
    for (const field of [
      'object',
      'quantity',
      'unit',
      'action',
      'notBefore',
      'condition',
      'owner',
    ] as const) {
      const retry = retryQuestion(item, field, true, language);
      expect(retry).not.toBe(first);
      expect(retry).not.toMatch(/\b8\b|15:00/);
      if (language !== 'en-IN') expect(retry).not.toMatch(/\b(?:Say|the|with)\b/);
    }
  });
});
