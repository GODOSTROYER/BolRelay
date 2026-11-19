import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  createDemoHandover,
  createHandover,
  recordReadback,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language, ParseIssue } from '../../src/domain';
import { allItemsMarker } from '../../src/domain/markers';
import {
  CRITICAL_INTERPRETATION_ISSUE_CODES,
  isCriticalIssue,
  suppressesCriticalIssue,
} from '../../src/domain/rulesVersion';
import { validateModelOutput } from '../../server/model';

type Body = { claims: unknown[]; issues: unknown[]; limitations: string[] };

const request = (state: HandoverState, text: string, language: Language = 'en-IN') => ({
  text,
  role: 'incoming' as const,
  language,
  utteranceId: 'model-review-1',
  items: state.items,
});
const statuses = (state: HandoverState, body: Body, text: string, language?: Language) => {
  const parsed = validateModelOutput(body, request(state, text, language));
  return Object.fromEntries(
    compareHandover(recordReadback(state, parsed)).map((entry) => [entry.itemId, entry.status]),
  );
};
const localStatus = (state: HandoverState, text: string, id: string, language?: Language) =>
  compareHandover(submitReadback(state, text, { language: language ?? 'en-IN' })).find(
    (entry) => entry.itemId === id,
  )!.status;

const nagpur = (quote: string, extra: Record<string, unknown> = {}) => ({
  itemIds: ['NAGPUR'],
  action: 'dispatch',
  quantity: 8,
  unit: 'parcel',
  notBefore: '15:00',
  uncertainFields: [],
  evidenceQuote: quote,
  fieldEvidence: {
    object: 'Nagpur',
    action: 'send',
    quantity: 'eight',
    unit: 'parcels',
    notBefore: 'after 3 PM',
  },
  ...extra,
});

describe('finding 1: a model claim may not drop what the local rules flag', () => {
  const hindi = 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा अगर मैनेजर बोले';
  const hindiClaim = (uncertainFields: string[] = []) => ({
    itemIds: ['NAGPUR'],
    action: 'dispatch',
    quantity: 8,
    unit: 'parcel',
    notBefore: '15:00',
    uncertainFields,
    evidenceQuote: hindi,
    fieldEvidence: {
      object: 'नागपुर',
      action: 'भेजूंगा',
      quantity: 'आठ',
      unit: 'पार्सल',
      notBefore: 'दोपहर तीन बजे के बाद',
    },
  });

  it('rejects a Hindi claim that drops an unrecognised condition', () => {
    const state = createDemoHandover('hi-IN');
    expect(localStatus(state, hindi, 'NAGPUR', 'hi-IN')).not.toBe('agreement');
    expect(() =>
      statuses(state, { claims: [hindiClaim()], issues: [], limitations: [] }, hindi, 'hi-IN'),
    ).toThrow(/suppresses|prerequisite/);
  });

  it('accepts the same claim when it keeps the condition uncertain, and never as agreement', () => {
    const state = createDemoHandover('hi-IN');
    const result = statuses(
      state,
      { claims: [hindiClaim(['condition'])], issues: [], limitations: [] },
      hindi,
      'hi-IN',
    );
    expect(result.NAGPUR).toBe('uncertainty');
  });

  it.each([
    'I will send eight Nagpur parcels after 3 PM subject to',
    'I will send eight Nagpur parcels after 3 PM if',
    'I will send eight Nagpur parcels after 3 PM if the manager approves',
    'I will send eight Nagpur parcels after 3 PM when it',
  ])('rejects an English claim that drops a condition: %s', (text) => {
    const state = createDemoHandover();
    expect(localStatus(state, text, 'NAGPUR')).not.toBe('agreement');
    expect(() =>
      statuses(state, { claims: [nagpur(text)], issues: [], limitations: [] }, text),
    ).toThrow(/suppresses|prerequisite/);
  });

  it('rejects a stated time the model leaves out', () => {
    const state = createDemoHandover();
    const text = 'I will send eight Nagpur parcels after 3 PM';
    const claim = nagpur(text);
    delete (claim as Record<string, unknown>).notBefore;
    delete (claim.fieldEvidence as Record<string, unknown>).notBefore;
    expect(() => statuses(state, { claims: [claim], issues: [], limitations: [] }, text)).toThrow(
      /time differs/,
    );
  });

  it('treats any local issue code as critical except an explicit small allowlist', () => {
    const issue = (code: string): ParseIssue => ({
      code,
      message: 'x',
      itemIds: ['NAGPUR'],
      field: 'condition',
      evidence: { utteranceId: 'u', start: 0, end: 1, text: 'x' },
    });
    for (const code of [
      ...CRITICAL_INTERPRETATION_ISSUE_CODES,
      'UNRECOGNISED_CONDITION',
      'UNRECOGNISED_ACTION',
      'AMBIGUOUS_GROUP',
      'UNRECOGNISED_OBJECT',
      'UNEXPLAINED_WORDING',
      'COMPOUND_CONDITION',
      'A_CODE_ADDED_LATER',
    ])
      expect(isCriticalIssue(issue(code))).toBe(true);
    expect(isCriticalIssue(issue('EMPTY_TRANSCRIPT'))).toBe(false);
    const claim = {
      id: 'c',
      itemIds: ['NAGPUR'],
      uncertainFields: [],
      evidence: issue('X').evidence,
    };
    expect(suppressesCriticalIssue(claim, [issue('A_CODE_ADDED_LATER')])).toBe(true);
    expect(
      suppressesCriticalIssue({ ...claim, uncertainFields: ['condition'] }, [
        issue('A_CODE_ADDED_LATER'),
      ]),
    ).toBe(false);
  });
});

describe('finding 2: a contradicting clause cannot be parked in another item', () => {
  const clean = 'I will send eight Nagpur parcels after 3 PM';
  it.each(['Actually thirty', 'Not really', 'Thirty of them tomorrow'])(
    'rejects "%s" attributed to J1',
    (tail) => {
      const state = createDemoHandover();
      const text = `${clean}. ${tail}`;
      expect(localStatus(state, text, 'NAGPUR')).not.toBe('agreement');
      expect(() =>
        statuses(
          state,
          {
            claims: [nagpur(clean)],
            issues: [
              { code: 'NOTE', message: 'x', itemIds: ['J1'], field: 'object', evidenceQuote: tail },
            ],
            limitations: [],
          },
          text,
        ),
      ).toThrow(/suppresses/);
    },
  );

  it('rejects a clean second statement about the item parked in another item', () => {
    const state = createDemoHandover();
    const second = 'I will send thirty Nagpur parcels after 3 PM';
    const text = `${clean}. ${second}`;
    expect(localStatus(state, text, 'NAGPUR')).not.toBe('agreement');
    expect(() =>
      statuses(
        state,
        {
          claims: [nagpur(clean)],
          issues: [
            { code: 'NOTE', message: 'x', itemIds: ['J1'], field: 'object', evidenceQuote: second },
          ],
          limitations: [],
        },
        text,
      ),
    ).toThrow(/different item/);
  });

  it('turns an unknown model issue code on an item into uncertainty, not agreement', () => {
    const state = createDemoHandover();
    const text = `${clean}. Truck is blue`;
    const result = statuses(
      state,
      {
        claims: [nagpur(clean, { uncertainFields: ['object'] })],
        issues: [
          {
            code: 'MODEL_INVENTED_CODE',
            message: 'x',
            itemIds: ['NAGPUR'],
            field: 'object',
            evidenceQuote: 'Truck is blue',
          },
        ],
        limitations: [],
      },
      text,
    );
    expect(result.NAGPUR).toBe('uncertainty');
  });
});

describe('finding 3: the model owner must match the local reading of the same clause', () => {
  const board = () =>
    createHandover({
      items: [
        {
          id: 'BLUE',
          label: 'Blue stock',
          aliases: ['blue'],
          quantity: 12,
          unit: 'carton',
          action: 'pack',
          notBefore: null,
          condition: null,
          owner: 'Ravi',
        },
        {
          id: 'RED',
          label: 'Red stock',
          aliases: ['red'],
          quantity: 4,
          unit: 'box',
          action: 'collect',
          notBefore: null,
          condition: null,
          owner: null,
        },
      ],
    });
  const blue = (quote: string, extra: Record<string, unknown> = {}) => ({
    itemIds: ['BLUE'],
    action: 'pack',
    quantity: 12,
    unit: 'carton',
    owner: 'Ravi',
    uncertainFields: [],
    evidenceQuote: quote,
    fieldEvidence: {
      object: 'blue',
      action: 'pack',
      quantity: 'twelve',
      unit: 'cartons',
      owner: 'Ravi',
    },
    ...extra,
  });

  it.each([
    'Tell Ravi I will pack twelve blue cartons',
    'Suresh will pack twelve blue cartons for Ravi',
    'Suresh will pack twelve blue cartons as Ravi is away',
  ])('rejects an owner the local rules do not read: %s', (text) => {
    expect(() =>
      statuses(board(), { claims: [blue(text)], issues: [], limitations: [] }, text),
    ).toThrow();
  });

  it('accepts the owner the local rules also read', () => {
    const text = 'Ravi will pack twelve blue cartons';
    expect(
      statuses(board(), { claims: [blue(text)], issues: [], limitations: [] }, text).BLUE,
    ).toBe('agreement');
  });

  it('accepts an unsupported owner only as uncertainty', () => {
    const text = 'Tell Ravi I will pack twelve blue cartons';
    const result = statuses(
      board(),
      { claims: [blue(text, { uncertainFields: ['owner'] })], issues: [], limitations: [] },
      text,
    );
    expect(result.BLUE).toBe('uncertainty');
  });
});

describe('finding 4: validation cost is bounded', () => {
  const sentences = Array.from(
    { length: 120 },
    (_, i) => `I will send Nagpur parcels after 3 PM ${'ok '.repeat(i % 7)}number ${i}.`,
  );
  const text = sentences.join(' ').slice(0, 5_990);

  it('rejects a response whose long distinct quotes far exceed the transcript, quickly', () => {
    const state = createDemoHandover();
    const claims = Array.from({ length: 100 }, (_, i) => ({
      itemIds: ['NAGPUR'],
      uncertainFields: ['action', 'quantity', 'unit', 'notBefore', 'condition', 'owner', 'object'],
      evidenceQuote: text.slice(0, text.length - i),
      fieldEvidence: { object: 'Nagpur' },
    }));
    const started = performance.now();
    expect(() =>
      validateModelOutput({ claims, issues: [], limitations: [] }, request(state, text)),
    ).toThrow(/longer than the transcript/);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('parses a repeated long quote once', () => {
    const state = createDemoHandover();
    const claims = Array.from({ length: 100 }, () => ({
      itemIds: ['NAGPUR'],
      uncertainFields: ['action', 'quantity', 'unit', 'notBefore', 'condition', 'owner', 'object'],
      evidenceQuote: text,
      fieldEvidence: { object: 'Nagpur' },
    }));
    const started = performance.now();
    try {
      validateModelOutput({ claims, issues: [], limitations: [] }, request(state, text));
    } catch {
      /* acceptance is not the point; the time is */
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('finding 5: one bounded "all items" marker', () => {
  it('reads Hindi and Marathi "all" words but not words that merely start with them', () => {
    for (const word of ['all', 'everything', 'सभी', 'सब', 'सबको', 'सारे', 'सगळे', 'सर्व'])
      expect(allItemsMarker.test(`${word} भेजो`)).toBe(true);
    for (const word of ['सब्जी', 'सबसे', 'सर्वर', 'ball'])
      expect(allItemsMarker.test(`${word} भेजो`)).toBe(false);
  });
});
