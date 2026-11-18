import { describe, expect, it } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import { parseTranscript } from '../../src/domain/parser';
import { validateModelOutput } from '../../server/model';

// P0: every field value of a model claim must be grounded in the clause that
// names the claim's items, not merely somewhere inside a broad evidence quote.

const request = (text: string, scopeItemIds?: string[]) => ({
  text,
  role: 'incoming' as const,
  language: 'en-IN' as const,
  utteranceId: 'p0-binding',
  items: createDemoHandover().items,
  ...(scopeItemIds ? { scopeItemIds } : {}),
});
type Claim = {
  itemIds: string[];
  action?: string;
  quantity?: number;
  unit?: string;
  notBefore?: string | null;
  condition?: string | null;
  owner?: string | null;
  uncertainFields: string[];
  evidenceQuote: string;
  fieldEvidence: Record<string, string>;
};
const output = (...claims: Claim[]) => ({ claims, issues: [], limitations: [] });

const nagpurAndJ1 =
  'I will send eight Nagpur parcels after 3 PM and hold J1 until the address is confirmed.';
const nagpurClaim: Claim = {
  itemIds: ['NAGPUR'],
  action: 'dispatch',
  quantity: 8,
  unit: 'parcel',
  notBefore: '15:00',
  uncertainFields: [],
  evidenceQuote: 'I will send eight Nagpur parcels after 3 PM',
  fieldEvidence: {
    object: 'Nagpur',
    action: 'send',
    quantity: 'eight',
    unit: 'parcels',
    notBefore: 'after 3 PM',
  },
};

describe('model field evidence is bound to the clause naming the item', () => {
  it('rejects a J1 claim that borrows quantity and time from the Nagpur clause', () => {
    const forged: Claim = {
      itemIds: ['J1'],
      action: 'hold',
      quantity: 8,
      notBefore: '15:00',
      condition: 'address confirmed',
      uncertainFields: [],
      evidenceQuote: nagpurAndJ1,
      fieldEvidence: {
        object: 'J1',
        action: 'hold',
        quantity: 'eight',
        notBefore: 'after 3 PM',
        condition: 'until the address is confirmed',
      },
    };
    expect(() => validateModelOutput(output(nagpurClaim, forged), request(nagpurAndJ1))).toThrow(
      /clause/,
    );
  });

  it('accepts the same J1 claim when every field comes from its own clause', () => {
    const honest: Claim = {
      itemIds: ['J1'],
      action: 'hold',
      condition: 'address confirmed',
      uncertainFields: [],
      evidenceQuote: nagpurAndJ1,
      fieldEvidence: {
        object: 'J1',
        action: 'hold',
        condition: 'until the address is confirmed',
      },
    };
    const parsed = validateModelOutput(output(nagpurClaim, honest), request(nagpurAndJ1));
    expect(parsed.claims[1]).toMatchObject({ itemIds: ['J1'], condition: 'address confirmed' });
    expect(parsed.claims[1]!.quantity).toBeUndefined();
    expect(parsed.claims[1]!.notBefore).toBeUndefined();
  });

  it('does not let a second claim sharing the quote inherit a prerequisite it never stated', () => {
    // Accepted before the fix: J2 silently gained "address confirmed" and matched the plan.
    const text = 'I will hold one parcel J1 until the address is confirmed and hold one parcel J2.';
    const claim = (id: string, condition: boolean): Claim => ({
      itemIds: [id],
      action: 'hold',
      quantity: 1,
      unit: 'parcel',
      ...(condition ? { condition: 'address confirmed' } : {}),
      uncertainFields: [],
      evidenceQuote: text,
      fieldEvidence: {
        object: id,
        action: 'hold',
        quantity: 'one',
        unit: 'parcel',
        ...(condition ? { condition: 'until the address is confirmed' } : {}),
      },
    });
    expect(() =>
      validateModelOutput(output(claim('J1', true), claim('J2', true)), request(text)),
    ).toThrow(/clause/);
    const parsed = validateModelOutput(
      output(claim('J1', true), claim('J2', false)),
      request(text),
    );
    expect(parsed.claims.map((c) => [c.itemIds[0], c.quantity, c.condition])).toEqual([
      ['J1', 1, 'address confirmed'],
      ['J2', 1, undefined],
    ]);
  });

  it('rejects an action taken from a clause that names a different item', () => {
    const text = 'J1 is with me. Send eight Nagpur parcels after 3 PM.';
    const forged: Claim = {
      itemIds: ['J1'],
      action: 'dispatch',
      uncertainFields: [],
      evidenceQuote: text,
      fieldEvidence: { object: 'J1', action: 'Send' },
    };
    const nagpur = {
      ...nagpurClaim,
      evidenceQuote: 'Send eight Nagpur parcels after 3 PM.',
      fieldEvidence: { ...nagpurClaim.fieldEvidence, action: 'Send' },
    };
    expect(() => validateModelOutput(output(forged, nagpur), request(text))).toThrow(/clause/);
  });

  it('rejects field evidence placed in an earlier sentence than the object', () => {
    const text = 'Eight parcels after 3 PM. Send Nagpur.';
    const forged: Claim = {
      itemIds: ['NAGPUR'],
      action: 'dispatch',
      quantity: 8,
      unit: 'parcel',
      notBefore: '15:00',
      uncertainFields: [],
      evidenceQuote: text,
      fieldEvidence: {
        object: 'Nagpur',
        action: 'Send',
        quantity: 'Eight',
        unit: 'parcels',
        notBefore: 'after 3 PM',
      },
    };
    expect(() => validateModelOutput(output(forged), request(text))).toThrow(/clause/);
  });

  it('rejects object evidence that spans several clauses', () => {
    const forged: Claim = {
      ...nagpurClaim,
      evidenceQuote: nagpurAndJ1,
      fieldEvidence: {
        ...nagpurClaim.fieldEvidence,
        object: 'Nagpur parcels after 3 PM and hold J1',
      },
    };
    expect(() => validateModelOutput(output(forged), request(nagpurAndJ1))).toThrow(/clause/);
  });

  it('rejects a group total attributed to one member of a mixed clause', () => {
    const text = 'Send J1 with the eight Nagpur parcels after 3 PM.';
    const forged: Claim = {
      itemIds: ['J1'],
      action: 'dispatch',
      quantity: 8,
      unit: 'parcel',
      notBefore: '15:00',
      uncertainFields: [],
      evidenceQuote: text,
      fieldEvidence: {
        object: 'J1',
        action: 'Send',
        quantity: 'eight',
        unit: 'parcels',
        notBefore: 'after 3 PM',
      },
    };
    expect(() => validateModelOutput(output(forged), request(text))).toThrow(/other items/);
  });

  it('keeps legitimate multi-item and scoped pronoun claims working', () => {
    const group = 'I will hold J1 and J2 until the address is confirmed.';
    expect(
      validateModelOutput(
        output({
          itemIds: ['J1', 'J2'],
          action: 'hold',
          condition: 'address confirmed',
          uncertainFields: [],
          evidenceQuote: group,
          fieldEvidence: {
            object: 'J1 and J2',
            action: 'hold',
            condition: 'until the address is confirmed',
          },
        }),
        request(group),
      ).claims[0]!.itemIds,
    ).toEqual(['J1', 'J2']);

    const pronoun = 'I will hold it until the address is confirmed.';
    expect(
      validateModelOutput(
        output({
          itemIds: ['J1'],
          action: 'hold',
          condition: 'address confirmed',
          uncertainFields: [],
          evidenceQuote: pronoun,
          fieldEvidence: {
            object: 'it',
            action: 'hold',
            condition: 'until the address is confirmed',
          },
        }),
        request(pronoun, ['J1']),
      ).claims[0]!.condition,
    ).toBe('address confirmed');

    const both = 'I will hold both Joshi parcels until the address is confirmed.';
    expect(
      validateModelOutput(
        output({
          itemIds: ['J1', 'J2'],
          action: 'hold',
          unit: 'parcel',
          condition: 'address confirmed',
          uncertainFields: [],
          evidenceQuote: both,
          fieldEvidence: {
            object: 'Joshi',
            action: 'hold',
            unit: 'parcels',
            condition: 'until the address is confirmed',
          },
        }),
        request(both),
      ).claims,
    ).toHaveLength(1);
  });
});

describe('local parser does not apply one item’s attributes to another item', () => {
  it('keeps each clause’s attributes on its own items', () => {
    const parsed = parseTranscript(request(nagpurAndJ1));
    expect(parsed.claims.map((c) => [c.itemIds, c.quantity, c.notBefore, c.condition])).toEqual([
      [['NAGPUR'], 8, '15:00', undefined],
      [['J1'], undefined, undefined, 'address confirmed'],
    ]);
  });

  it('does not attribute a named group’s quantity to an explicit ID in the same clause', () => {
    // The group is named only by its alias (its ID "N7" is not spoken). Before the fix the
    // explicit ID hid the Nagpur reference, so J1 alone got 8 parcels at 15:00.
    const items = createDemoHandover().items.map((item) =>
      item.id === 'NAGPUR' ? { ...item, id: 'N7' } : item,
    );
    for (const text of [
      'Send J1 with the eight Nagpur parcels after 3 PM.',
      'I will send eight Nagpur parcels after 3 PM and J1 until the address is confirmed.',
    ]) {
      const parsed = parseTranscript({ ...request(text), items });
      expect(parsed.claims).toHaveLength(1);
      expect([...parsed.claims[0]!.itemIds].sort()).toEqual(['J1', 'N7']);
    }
    // The model path rejects an 8-parcel J1 claim from that clause.
    const text = 'Send J1 with the eight Nagpur parcels after 3 PM.';
    const forged: Claim = {
      itemIds: ['J1'],
      action: 'dispatch',
      quantity: 8,
      unit: 'parcel',
      uncertainFields: [],
      evidenceQuote: text,
      fieldEvidence: { object: 'J1', action: 'Send', quantity: 'eight', unit: 'parcels' },
    };
    expect(() => validateModelOutput(output(forged), { ...request(text), items })).toThrow(
      /other items/,
    );
  });

  it('still lets an explicit ID narrow a shared alias', () => {
    const parsed = parseTranscript(request('I will hold Joshi J1 until the address is confirmed.'));
    expect(parsed.claims[0]!.itemIds).toEqual(['J1']);
  });
});
