import { describe, expect, it } from 'vitest';
import {
  clarificationField,
  compareHandover,
  completeShortAnswer,
  confirmItem,
  createDemoHandover,
  createHandover,
  DEMO_TRANSCRIPTS,
  handoverStateSchema,
  INTERPRETATION_RULES_VERSION,
  parseTranscript,
  pendingSourceReviewItemIds,
  recordReadback,
  restoreHandover,
  revalidateInterpretations,
} from '../../src/domain';
import type { HandoverState, ParsedTranscript } from '../../src/domain';
import { importHandover, serializeHandoverExport } from '../../src/lib/export';

/** A read-back whose stored quantity (8) is not what its words say (nine). */
const NINE =
  'I will send nine Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';

function wronglyApproved(parser: ParsedTranscript['parser'], stamp?: number): HandoverState {
  let state = createDemoHandover();
  const current = parseTranscript({
    text: NINE,
    role: 'incoming',
    language: 'en-IN',
    items: state.items,
    utteranceId: 'wrong-reading',
  });
  expect(current.claims.find((claim) => claim.itemIds.includes('NAGPUR'))?.quantity).toBe(9);
  state = recordReadback(state, {
    ...current,
    parser,
    claims: current.claims.map((claim) =>
      claim.itemIds.includes('NAGPUR') ? { ...claim, quantity: 8 } : claim,
    ),
  });
  for (const item of state.items) state = confirmItem(state, item.id);
  expect(state.confirmations.NAGPUR).toBeDefined();
  const copy = structuredClone(state);
  for (const utterance of copy.utterances)
    if (utterance.utteranceId === 'wrong-reading') {
      if (stamp === undefined) delete utterance.rulesVersion;
      else utterance.rulesVersion = stamp;
    }
  return copy;
}

/** A model read-back that the current local rules read the same way. */
function consistentModelApproval(): HandoverState {
  let state = createDemoHandover();
  const parsed = parseTranscript({
    text: DEMO_TRANSCRIPTS['en-IN'].corrected,
    role: 'incoming',
    language: 'en-IN',
    items: state.items,
    utteranceId: 'model-good',
  });
  state = recordReadback(state, { ...parsed, parser: 'model' });
  for (const item of state.items) state = confirmItem(state, item.id);
  return state;
}

describe('review finding 1: revalidation output always fits the schema', () => {
  function manyLongItemsApprovedWrongly(count: number): HandoverState {
    const names = Array.from(
      { length: count },
      (_, i) =>
        `Depot${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}x`,
    );
    let state = createHandover({
      id: 'many-items',
      items: names.map((name, i) => ({
        id: `I${i}`,
        label: `${name} parcels ${'with a very long descriptive label '.repeat(5)}`.slice(0, 160),
        aliases: [name],
        quantity: 8,
        unit: 'parcel',
        action: 'dispatch' as const,
        notBefore: null,
        condition: null,
        owner: null,
      })),
    });
    expect(state.items.every((item) => item.label.length === 160)).toBe(true);
    const parsed = parseTranscript({
      text: names.map((name) => `I will send nine ${name} parcels.`).join(' '),
      role: 'incoming',
      language: 'en-IN',
      items: state.items,
      utteranceId: 'old-reading',
    });
    expect(parsed.claims).toHaveLength(count);
    state = recordReadback(state, {
      ...parsed,
      claims: parsed.claims.map((claim) => ({ ...claim, quantity: 8 })),
    });
    for (const item of state.items) state = confirmItem(state, item.id);
    expect(Object.keys(state.confirmations)).toHaveLength(count);
    return state;
  }

  it('bounds the system message for 60 reopened items with 160-character labels', () => {
    const saved = manyLongItemsApprovedWrongly(60);
    const revalidated = revalidateInterpretations(structuredClone(saved));
    expect(revalidated.confirmations).toEqual({});
    const event = revalidated.events.at(-1)!;
    expect(event.type).toBe('interpretation-upgraded');
    expect(event.itemIds).toHaveLength(60);
    expect(event.message.length).toBeLessThanOrEqual(1_000);
    expect(event.message).toMatch(/60 items/);
    expect(handoverStateSchema.safeParse(revalidated).success).toBe(true);
    // The whole load/commit/export path keeps working with the result.
    const loaded = restoreHandover(saved);
    expect(loaded.confirmations).toEqual({});
    expect(restoreHandover(loaded)).toEqual(loaded);
    expect(() => serializeHandoverExport(loaded)).not.toThrow();
  });

  it('keeps the source review list within its 500-entry limit', () => {
    const state = createDemoHandover();
    // The saved outgoing reading no longer matches its words (8 Nagpur parcels).
    state.utterances[0]!.claims = state.utterances[0]!.claims.map((claim) =>
      claim.itemIds.includes('NAGPUR') ? { ...claim, quantity: 9 } : claim,
    );
    const nagpur = state.items.find((item) => item.id === 'NAGPUR')!;
    state.sourceReview = Array.from({ length: 500 }, (_, i) => ({
      itemId: 'NAGPUR',
      itemRevision: nagpur.revision,
      utteranceId: `older-source-${i}`,
      reviewed: true,
      createdAt: state.createdAt,
    }));
    const loaded = restoreHandover(state);
    expect(handoverStateSchema.safeParse(loaded).success).toBe(true);
    expect(loaded.sourceReview!.length).toBeLessThanOrEqual(500);
    expect(pendingSourceReviewItemIds(loaded)).toEqual(['NAGPUR']);
  });
});

describe('review finding 3: forged model stamps cannot keep a wrong approval', () => {
  for (const stamp of [undefined, 1, INTERPRETATION_RULES_VERSION, 999_999])
    it(`reopens a local reading relabelled as model with stamp ${stamp}`, () => {
      const loaded = restoreHandover(wronglyApproved('model', stamp));
      expect(loaded.confirmations.NAGPUR).toBeUndefined();
      expect(loaded.readbacks.NAGPUR).toBeUndefined();
      expect(loaded.recheckNotice?.itemIds).toContain('NAGPUR');
      expect(restoreHandover(loaded)).toEqual(loaded);
    });

  it('never trusts a rules version newer than this build', () => {
    const state = consistentModelApproval();
    expect(restoreHandover(state).confirmations.NAGPUR).toBeDefined();
    const future = structuredClone(state);
    future.utterances.find((u) => u.utteranceId === 'model-good')!.rulesVersion =
      INTERPRETATION_RULES_VERSION + 1;
    expect(restoreHandover(future).confirmations).toEqual({});
  });

  it('reopens a stored model value the local reading of its quote does not support', () => {
    let state = createDemoHandover();
    const parsed = parseTranscript({
      text: 'I will send eight Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.',
      role: 'incoming',
      language: 'en-IN',
      items: state.items,
      utteranceId: 'model-added-time',
    });
    // The model supplied the plan's time, which the words never state.
    state = recordReadback(state, {
      ...parsed,
      parser: 'model',
      claims: parsed.claims.map((claim) =>
        claim.itemIds.includes('NAGPUR') ? { ...claim, notBefore: '15:00' } : claim,
      ),
    });
    state = confirmItem(state, 'NAGPUR');
    expect(state.utterances.at(-1)?.rulesVersion).toBe(INTERPRETATION_RULES_VERSION);
    const loaded = restoreHandover(state);
    expect(loaded.confirmations.NAGPUR).toBeUndefined();
    expect(loaded.readbacks.NAGPUR).toBeUndefined();
    // J1/J2 agree with the local reading and keep their read-backs.
    expect(loaded.readbacks.J1).toBeDefined();
    expect(restoreHandover(loaded)).toEqual(loaded);
  });

  it('treats imported model read-backs as unverifiable', async () => {
    const state = consistentModelApproval();
    // This browser's own saved state keeps it...
    expect(restoreHandover(state)).toEqual(state);
    // ...an imported file does not.
    const imported = await importHandover(
      new File([serializeHandoverExport(state)], 'handover.json'),
    );
    expect(imported.confirmations).toEqual({});
    expect(imported.readbacks).toEqual({});
    expect(imported.recheckNotice?.itemIds.sort()).toEqual(['J1', 'J2', 'NAGPUR']);
  });
});

describe('review finding 7: a short answer on a model read-back is not reopened', () => {
  it('records the answer on its own and keeps it across commits and reloads', () => {
    let state = createDemoHandover();
    // A model reading of a statement without the required time (it agrees with
    // the local reading, as the server now requires).
    const text =
      'I will send eight Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.';
    const local = parseTranscript({
      text,
      role: 'incoming',
      language: 'en-IN',
      items: state.items,
      utteranceId: 'model-basis',
    });
    const model: ParsedTranscript = { ...local, parser: 'model' };
    state = restoreHandover(recordReadback(state, model));
    expect(state.readbacks.NAGPUR).toBeDefined();
    const nagpur = compareHandover(state).find((entry) => entry.itemId === 'NAGPUR')!;
    const answerField = clarificationField(nagpur);
    expect(answerField).toBe('notBefore');
    const answer = parseTranscript({
      text: 'after 3 PM',
      role: 'incoming',
      language: 'en-IN',
      items: state.items,
      utteranceId: 'short-answer',
      scopeItemIds: ['NAGPUR'],
      answerField,
    });
    const completed = completeShortAnswer(state, answer);
    expect(completed.claims.some((claim) => claim.basis)).toBe(false);
    const recorded = recordReadback(state, completed, {
      mode: 'targeted',
      scopeItemIds: ['NAGPUR'],
    });
    // What App.commit does, then a later reload: the answer is not reopened.
    const committed = restoreHandover(recorded, { previous: state });
    expect(committed.readbacks.NAGPUR?.utteranceId).toBe('short-answer');
    expect(committed.events.at(-1)?.type).toBe('readback-recorded');
    const reloaded = restoreHandover(JSON.parse(JSON.stringify(committed)));
    expect(reloaded.readbacks.NAGPUR?.utteranceId).toBe('short-answer');
    expect(reloaded).toEqual(committed);
  });
});
