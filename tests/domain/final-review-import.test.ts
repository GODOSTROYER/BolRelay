import { describe, expect, it } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import {
  compareHandover,
  confirmItem,
  DomainError,
  restoreHandover,
  reviseItem,
  submitReadback,
} from '../../src/domain/engine';
import { createReviewedHandover, draftInstructions } from '../../src/domain/draft';
import { parseTranscript } from '../../src/domain/parser';
import { acknowledgeSourceReview, pendingSourceReviewItemIds } from '../../src/domain/revalidation';
import type { HandoverState } from '../../src/domain/types';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const imported = (state: HandoverState) => restoreHandover(copy(state), { origin: 'import' });

/** A handover whose only item is "Hold eight Nagpur parcels until the address is confirmed." */
function heldNagpur(): HandoverState {
  return createReviewedHandover(
    draftInstructions('Hold eight Nagpur parcels until the address is confirmed.', 'en-IN'),
    { title: 'Night shift', outgoingName: 'Asha', incomingName: 'Ravi' },
  );
}

/** The plan is edited outside the app to dispatch, keeping the quote that says hold. */
function contradictedThenConfirmed(
  evidenceFields?: HandoverState['items'][number]['evidenceFields'],
) {
  const forged = copy(heldNagpur());
  const item = forged.items[0]!;
  item.action = 'dispatch';
  item.condition = null;
  if (evidenceFields) item.evidenceFields = evidenceFields;
  else delete item.evidenceFields;
  // The incoming worker reads back the edited plan and confirms it.
  // (Built directly, as a crafted file would be, without passing a trust boundary.)
  let state = submitReadback(forged, 'I will send eight Nagpur parcels.');
  state = confirmItem(state, item.id);
  expect(compareHandover(state)[0]!.confirmed).toBe(true);
  return { state: copy(state), itemId: item.id };
}

describe('final review N4: an imported plan must agree with the quote it shows', () => {
  for (const [name, fields] of [
    ['without evidenceFields', undefined],
    ["with evidenceFields ['object']", ['object'] as const],
  ] as const) {
    it(`flags a plan that contradicts its own source quote (${name}) and reopens it`, () => {
      const { state, itemId } = contradictedThenConfirmed(fields ? [...fields] : undefined);
      const result = imported(state);
      expect(pendingSourceReviewItemIds(result)).toEqual([itemId]);
      expect(result.confirmations[itemId]).toBeUndefined();
      expect(result.readbacks[itemId]).toBeUndefined();
      expect(result.recheckNotice?.itemIds).toContain(itemId);
      // The plan itself is never rewritten.
      expect(result.items[0]!.action).toBe('dispatch');
      expect(result.events.at(-1)!.message).toMatch(/does not match the instruction words/);
      // Reloading the flagged result changes nothing more.
      expect(JSON.stringify(restoreHandover(copy(result)))).toBe(JSON.stringify(result));
    });
  }

  it('also applies to this browser’s own saved data', () => {
    const { state, itemId } = contradictedThenConfirmed();
    expect(restoreHandover(state).confirmations[itemId]).toBeUndefined();
  });

  it('a reviewed plan can be read back and confirmed again, and stays confirmed on import', () => {
    const { state, itemId } = contradictedThenConfirmed();
    let next = imported(state);
    next = restoreHandover(acknowledgeSourceReview(next), { previous: next });
    next = restoreHandover(submitReadback(next, 'I will send eight Nagpur parcels.'), {
      previous: next,
    });
    next = restoreHandover(confirmItem(next, itemId), { previous: next });
    expect(pendingSourceReviewItemIds(next)).toEqual([]);
    expect(imported(next).confirmations[itemId]).toBeDefined();
  });

  it('keeps consistent plans unflagged: reviewed instructions, the example and in-app edits', () => {
    const reviewed = heldNagpur();
    expect(imported(reviewed).sourceReview).toBeUndefined();

    let example = createDemoHandover();
    example = submitReadback(
      example,
      'I will send eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.',
    );
    for (const item of example.items) example = confirmItem(example, item.id);
    const loaded = imported(example);
    expect(loaded.sourceReview).toBeUndefined();
    expect(Object.keys(loaded.confirmations).sort()).toEqual(['J1', 'J2', 'NAGPUR']);

    // A manual edit (item editor) drops the old quote.
    const manual = reviseItem(reviewed, reviewed.items[0]!.id, {
      action: 'dispatch',
      condition: null,
    });
    expect(manual.items[0]!.evidence).toEqual([]);
    expect(imported(manual).sourceReview).toBeUndefined();

    // A spoken change records the new quote and only the fields it states.
    const spoken = parseTranscript({
      text: 'Send the Nagpur parcels.',
      role: 'outgoing',
      language: 'en-IN',
      items: reviewed.items,
      utteranceId: 'spoken-change',
    });
    const claim = spoken.claims[0]!;
    expect(claim.action).toBe('dispatch');
    const changed = reviseItem(reviewed, reviewed.items[0]!.id, {
      action: 'dispatch',
      evidence: [claim.evidence],
    });
    const withSource: HandoverState = {
      ...changed,
      utterances: [...changed.utterances, { ...spoken, createdAt: changed.updatedAt }],
    };
    expect(imported(withSource).sourceReview).toBeUndefined();
  });
});

describe('final review N6: a full history gives a clear refusal', () => {
  const atEventLimit = () => {
    const state = copy(restoreHandover(createDemoHandover()));
    while (state.events.length < 5_000)
      state.events.push({
        ...state.events[0]!,
        id: `filler-${state.events.length}`,
        type: 'item-confirmed',
        itemIds: [],
        message: 'Filler history entry',
      });
    return restoreHandover(state);
  };

  it('names the history limit instead of calling the handover unsupported', () => {
    const full = atEventLimit();
    for (const change of [
      (state: HandoverState) =>
        submitReadback(state, 'I will send eight Nagpur parcels after 3 PM.', {
          scopeItemIds: ['NAGPUR'],
        }),
      (state: HandoverState) => reviseItem(state, 'J1', { quantity: 2 }),
    ]) {
      let error: unknown;
      try {
        restoreHandover(change(full), { previous: full });
      } catch (cause) {
        error = cause;
      }
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('HISTORY_LIMIT');
      expect((error as Error).message).toMatch(/history limit/);
      expect((error as Error).message).toMatch(/export/i);
      expect((error as Error).message).not.toMatch(/not a supported/);
    }
    // Nothing is dropped from the saved history.
    expect(full.events).toHaveLength(5_000);
  });

  it('names the history limit for the recording limit too', () => {
    const state = copy(restoreHandover(createDemoHandover()));
    const template = submitReadback(state, 'I will send eight Nagpur parcels.').utterances.at(-1)!;
    const crowded = {
      ...state,
      utterances: Array.from({ length: 2_001 }, (_, index) => ({
        ...template,
        utteranceId: `u-${index}`,
        claims: [],
        issues: [],
      })),
    };
    expect(() => restoreHandover(crowded)).toThrow(/history limit/);
  });
});
