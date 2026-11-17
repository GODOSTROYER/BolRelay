import { describe, expect, it } from 'vitest';
import {
  addItem,
  compareHandover,
  confirmItem,
  createDemoHandover,
  createHandover,
  DEMO_TRANSCRIPTS,
  parseTranscript,
  recordReadback,
  removeItem,
  restoreHandover,
  reviseItem,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';

const byId = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!;

describe('grounded dispatch task', () => {
  it.each(['en-IN', 'hi-IN', 'mr-IN'] as Language[])(
    'catches the all-ten mistake but accepts the corrected account (%s)',
    (language) => {
      const initial = createDemoHandover(language);
      const wrong = submitReadback(initial, DEMO_TRANSCRIPTS[language].mistaken);
      expect(byId(wrong, 'NAGPUR').status).toBe('agreement');
      expect(byId(wrong, 'J1').status).toBe('contradiction');
      expect(byId(wrong, 'J2').status).toBe('contradiction');
      const fixed = submitReadback(wrong, DEMO_TRANSCRIPTS[language].corrected);
      expect(compareHandover(fixed).map((item) => item.status)).toEqual([
        'agreement',
        'agreement',
        'agreement',
      ]);
      // The original plan is never mutated by the recipient's account.
      expect(initial.items.map((item) => item.action)).toEqual(['dispatch', 'hold', 'hold']);
      expect(initial.readbacks).toEqual({});
      expect(initial.utterances).toHaveLength(1);
    },
  );

  it.each(['en-IN', 'hi-IN', 'mr-IN'] as Language[])(
    'accepts the supported harmless paraphrase (%s)',
    (language) => {
      const state = submitReadback(
        createDemoHandover(language),
        DEMO_TRANSCRIPTS[language].harmless,
      );
      expect(compareHandover(state).map((item) => item.status)).toEqual([
        'agreement',
        'agreement',
        'agreement',
      ]);
    },
  );

  it('separates a missing release time and omitted group from a contradiction', () => {
    const state = submitReadback(createDemoHandover(), 'I will send eight Nagpur parcels.');
    expect(byId(state, 'NAGPUR').status).toBe('omission');
    expect(byId(state, 'NAGPUR').findings.map((f) => f.field)).toContain('notBefore');
    expect(byId(state, 'J1').status).toBe('omission');
    expect(byId(state, 'J1').findings.some((f) => f.status === 'contradiction')).toBe(false);
  });

  it('resolves an explicit quantity self-correction without accepting both old and new numbers', () => {
    const state = submitReadback(
      createDemoHandover(),
      'I will send twelve, sorry eight Nagpur parcels after 3 PM.',
    );
    expect(byId(state, 'NAGPUR').status).toBe('agreement');
    expect(state.readbacks.NAGPUR!.claims[0]!.quantity).toBe(8);
  });

  it('handles custom catalogue items, ownership and unit mismatches', () => {
    const initial = createHandover({
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
      ],
    });
    const good = submitReadback(initial, 'Pack twelve blue cartons; owner is Ravi.', {
      scopeItemIds: ['BLUE'],
    });
    // Separate ownership-only clauses are explicitly unresolved by the bounded grammar.
    expect(byId(good, 'BLUE').status).not.toBe('agreement');
    const exact = submitReadback(initial, 'Pack twelve blue cartons assigned to Ravi.');
    expect(byId(exact, 'BLUE').status).toBe('agreement');
    const wrong = submitReadback(initial, 'Pack twelve blue pieces assigned to Asha.');
    expect(byId(wrong, 'BLUE').findings.map((f) => f.field)).toEqual(
      expect.arrayContaining(['unit', 'owner']),
    );
  });

  it('keeps an ambiguous duplicate name unresolved', () => {
    const initial = createHandover({
      items: ['R1', 'R2'].map((id) => ({
        id,
        label: `Ravi ${id}`,
        aliases: ['Ravi'],
        quantity: 1,
        unit: 'parcel',
        action: 'hold' as const,
        notBefore: null,
        condition: 'address confirmed',
        owner: null,
      })),
    });
    const state = submitReadback(initial, 'Hold Ravi until the address is confirmed.');
    expect(compareHandover(state).every((item) => item.status === 'uncertainty')).toBe(true);
  });

  it('rejects an older recording even when no instruction revision changed', () => {
    const initial = createDemoHandover();
    const origin = Date.parse(initial.createdAt);
    const first = submitReadback(initial, DEMO_TRANSCRIPTS['en-IN'].corrected, {
      at: new Date(origin + 2_000).toISOString(),
    });
    expect(() =>
      submitReadback(first, DEMO_TRANSCRIPTS['en-IN'].mistaken, {
        at: new Date(origin + 1_000).toISOString(),
      }),
    ).toThrow(/older/);
    expect(byId(first, 'J1').status).toBe('agreement');
  });

  it('invalidates approvals that depend on a changed aggregate quantity', () => {
    let state = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
    state = confirmItem(confirmItem(state, 'J1'), 'J2');
    const revised = reviseItem(state, 'J1', { quantity: 2 });
    expect(byId(revised, 'J1').stale).toBe(true);
    expect(byId(revised, 'J2').confirmed).toBe(false);
    expect(byId(revised, 'J2').findings.some((f) => f.field === 'quantity')).toBe(true);
    expect(() => restoreHandover(revised)).not.toThrow();
  });

  it('does not lose unrelated records when adding/removing a custom item', () => {
    let state = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
    state = confirmItem(state, 'NAGPUR');
    const added = addItem(state, {
      id: 'C1',
      label: 'Counter pickup',
      aliases: ['counter'],
      quantity: 1,
      unit: 'parcel',
      action: 'collect',
      notBefore: null,
      condition: null,
      owner: null,
    });
    expect(byId(added, 'C1').status).toBe('omission');
    const removed = removeItem(added, 'C1');
    expect(byId(removed, 'NAGPUR').confirmed).toBe(true);
    expect(() => restoreHandover(removed)).not.toThrow();
  });

  it('blocks unknown object references and a reused ID with altered content', () => {
    const initial = createDemoHandover();
    const parsed = parseTranscript({
      text: DEMO_TRANSCRIPTS['en-IN'].corrected,
      role: 'incoming',
      language: 'en-IN',
      items: initial.items,
    });
    const bad = structuredClone(parsed);
    bad.claims[0]!.itemIds = ['NOT-ON-BOARD'];
    expect(() => recordReadback(initial, bad)).toThrow(/outside/);
    const recorded = recordReadback(initial, parsed);
    expect(() => recordReadback(recorded, { ...parsed, text: 'Different content' })).toThrow(
      /already used/,
    );
  });

  it.each(['__proto__', 'constructor', 'prototype', 'toString'])(
    'rejects unsafe object-map identifiers: %s',
    (id) => {
      expect(() =>
        createHandover({
          items: [
            {
              id,
              label: 'Unsafe record',
              aliases: [],
              quantity: 1,
              unit: 'parcel',
              action: 'hold',
              notBefore: null,
              condition: null,
              owner: null,
            },
          ],
        }),
      ).toThrow(/Reserved/);
    },
  );

  it('does not preserve an obsolete source quote after a manual instruction correction', () => {
    const initial = createDemoHandover();
    expect(initial.items[0]!.evidence.length).toBeGreaterThan(0);
    const revised = reviseItem(initial, 'NAGPUR', { quantity: 7 });
    expect(revised.items[0]!.evidence).toEqual([]);
    expect(revised.events.at(-1)!.before![0]!.evidence.length).toBeGreaterThan(0);
    expect(revised.events.at(-1)!.after![0]!.quantity).toBe(7);
  });

  it.each([
    'Should I send eight Nagpur parcels after 3 PM?',
    'I will send eight Nagpur parcels after 3 PM tomorrow.',
  ])('keeps a question or an unsupported date unresolved: %s', (text) => {
    const state = submitReadback(createDemoHandover(), text);
    expect(byId(state, 'NAGPUR').status).toBe('uncertainty');
    expect(() => confirmItem(state, 'NAGPUR')).toThrow();
  });
});
