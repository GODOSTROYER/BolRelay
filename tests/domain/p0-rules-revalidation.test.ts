import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeSourceReview,
  compareHandover,
  confirmItem,
  createDemoHandover,
  DEMO_TRANSCRIPTS,
  INTERPRETATION_RULES_VERSION,
  parseTranscript,
  pendingSourceReviewItemIds,
  recordReadback,
  restoreHandover,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, ParsedTranscript } from '../../src/domain';
import { importHandover } from '../../src/lib/export';
import { readWorkspace, restoreWorkspaceBackup, STORAGE_KEY } from '../../src/lib/persistence';

// Simulate the corrected compound-number rule so this suite never depends on
// the parallel parser fix landing. Once parser.ts reads "thirty eight" as 38
// itself, this wrapper is a no-op.
vi.mock('../../src/domain/parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/domain/parser')>();
  return {
    ...actual,
    parseTranscript: (input: Parameters<typeof actual.parseTranscript>[0]) => {
      const parsed = actual.parseTranscript(input);
      return {
        ...parsed,
        claims: parsed.claims.map((claim) =>
          /thirty[\s-]eight/i.test(claim.evidence.text) && claim.quantity === 8
            ? { ...claim, quantity: 38 }
            : claim,
        ),
      };
    },
  };
});

const THIRTY_EIGHT =
  'I will send thirty eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';
const result = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!;

function withoutStamps(state: HandoverState): HandoverState {
  const copy = structuredClone(state);
  for (const utterance of copy.utterances) delete utterance.rulesVersion;
  return copy;
}

/** Old buggy rules read "thirty eight" as 8; the plan says 8, so it was approved. */
function approvedUnderOldRules(): HandoverState {
  let state = createDemoHandover();
  const current = parseTranscript({
    text: THIRTY_EIGHT,
    role: 'incoming',
    language: 'en-IN',
    items: state.items,
    utteranceId: 'readback-old-rules',
  });
  const oldReading: ParsedTranscript = {
    ...current,
    claims: current.claims.map((claim) =>
      claim.itemIds.includes('NAGPUR') ? { ...claim, quantity: 8 } : claim,
    ),
  };
  state = recordReadback(state, oldReading);
  for (const item of state.items) state = confirmItem(state, item.id);
  expect(compareHandover(state).every((item) => item.confirmed)).toBe(true);
  return withoutStamps(state);
}

function expectOnlyNagpurReopened(saved: HandoverState, loaded: HandoverState) {
  expect(loaded.items).toEqual(saved.items);
  expect(loaded.utterances).toEqual(saved.utterances);
  expect(loaded.events.slice(0, saved.events.length)).toEqual(saved.events);
  expect(loaded.events).toHaveLength(saved.events.length + 1);
  expect(loaded.events.at(-1)).toMatchObject({
    type: 'interpretation-upgraded',
    itemIds: ['NAGPUR'],
  });
  expect(loaded.events.at(-1)?.message).toMatch(/interpretation rules changed/);
  expect(loaded.readbacks.NAGPUR).toBeUndefined();
  expect(loaded.confirmations.NAGPUR).toBeUndefined();
  expect(result(loaded, 'NAGPUR')).toMatchObject({ status: 'omission', confirmed: false });
  expect(loaded.recheckNotice).toMatchObject({
    reason: 'interpretation-rules-changed',
    itemIds: ['NAGPUR'],
  });
  for (const id of ['J1', 'J2']) {
    expect(loaded.confirmations[id]).toEqual(saved.confirmations[id]);
    expect(result(loaded, id).confirmed).toBe(true);
  }
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

describe('saved approvals are revalidated after interpretation rule changes', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('stamps newly stored interpretations with the current rules version', () => {
    const demo = createDemoHandover();
    expect(demo.utterances[0]?.rulesVersion).toBe(INTERPRETATION_RULES_VERSION);
    const state = submitReadback(demo, DEMO_TRANSCRIPTS['en-IN'].corrected);
    expect(state.utterances.at(-1)?.rulesVersion).toBe(INTERPRETATION_RULES_VERSION);
    expect(restoreHandover(state)).toEqual(state);
  });

  it('reopens only the changed item when saved browser state is loaded, once', () => {
    const saved = approvedUnderOldRules();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, handovers: [saved], activeId: saved.id }),
    );
    const first = readWorkspace();
    expect(first.warning).toBeNull();
    const loaded = first.handovers[0]!;
    expectOnlyNagpurReopened(saved, loaded);
    expect(loaded.utterances.find((u) => u.utteranceId === 'readback-old-rules')?.text).toBe(
      THIRTY_EIGHT,
    );

    // Idempotent: loading again (or re-saving) neither repeats the event nor reopens again.
    expect(restoreHandover(loaded)).toEqual(loaded);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, handovers: [loaded], activeId: loaded.id }),
    );
    expect(readWorkspace().handovers[0]).toEqual(loaded);

    // A fresh read-back under current rules can be confirmed and survives reloads.
    let repaired = submitReadback(loaded, 'I will send eight Nagpur parcels after 3 PM.', {
      scopeItemIds: ['NAGPUR'],
    });
    repaired = confirmItem(repaired, 'NAGPUR');
    expect(repaired.recheckNotice).toBeUndefined();
    expect(restoreHandover(repaired)).toEqual(repaired);
  });

  it('revalidates a handover import even when it claims the current rules version', async () => {
    const saved = approvedUnderOldRules();
    for (const utterance of saved.utterances) utterance.rulesVersion = INTERPRETATION_RULES_VERSION;
    const file = new File(
      [JSON.stringify({ format: 'bolrelay-handover', version: 1, handover: saved })],
      'handover.json',
      { type: 'application/json' },
    );
    expectOnlyNagpurReopened(saved, await importHandover(file));
  });

  it('revalidates a whole-workspace backup restore before saving it', () => {
    const saved = approvedUnderOldRules();
    const restored = restoreWorkspaceBackup(
      JSON.stringify({ version: 1, handovers: [saved], activeId: saved.id }),
    );
    expectOnlyNagpurReopened(saved, restored.handovers[0]!);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      handovers: HandoverState[];
    };
    expect(stored.handovers[0]).toEqual(restored.handovers[0]);
  });

  it('keeps every confirmation when the re-derived interpretation is unchanged', () => {
    let state = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
    for (const item of state.items) state = confirmItem(state, item.id);
    const unstamped = withoutStamps(state);
    expect(restoreHandover(unstamped)).toEqual(unstamped);
    expect(compareHandover(restoreHandover(unstamped)).every((item) => item.confirmed)).toBe(true);
  });

  it('flags a changed outgoing source for review without rewriting the plan', () => {
    const demo = createDemoHandover();
    const current = parseTranscript({
      text: 'Send thirty eight Nagpur parcels after 3 PM. Hold two Joshi parcels until the address is confirmed.',
      role: 'outgoing',
      language: 'en-IN',
      items: demo.items,
      utteranceId: 'outgoing-old-rules',
    });
    const oldReading = {
      ...current,
      claims: current.claims.map((claim) =>
        claim.itemIds.includes('NAGPUR') ? { ...claim, quantity: 8 } : claim,
      ),
    };
    let state: HandoverState = {
      ...demo,
      utterances: [{ ...oldReading, createdAt: demo.createdAt }],
      items: demo.items.map((item) => ({
        ...item,
        evidence: oldReading.claims
          .filter((claim) => claim.itemIds.includes(item.id))
          .map((claim) => claim.evidence),
      })),
    };
    state = submitReadback(state, DEMO_TRANSCRIPTS['en-IN'].corrected);
    for (const item of state.items) state = confirmItem(state, item.id);

    const loaded = restoreHandover(state);
    expect(loaded.items).toEqual(state.items);
    expect(loaded.utterances).toEqual(state.utterances);
    expect(pendingSourceReviewItemIds(loaded)).toEqual(['NAGPUR']);
    expect(loaded.confirmations.NAGPUR).toBeUndefined();
    expect(loaded.readbacks.NAGPUR).toBeUndefined();
    expect(result(loaded, 'J1').confirmed).toBe(true);
    expect(result(loaded, 'J2').confirmed).toBe(true);
    expect(loaded.events.at(-1)).toMatchObject({ type: 'interpretation-upgraded' });
    expect(loaded.events.at(-1)?.message).toMatch(/plan was not changed/);
    expect(restoreHandover(loaded)).toEqual(loaded);

    // After the outgoing participant reviews the plan, the same source is not re-flagged.
    const reviewed = restoreHandover(acknowledgeSourceReview(loaded));
    expect(pendingSourceReviewItemIds(reviewed)).toEqual([]);
    let reconfirmed = submitReadback(reviewed, 'I will send eight Nagpur parcels after 3 PM.', {
      scopeItemIds: ['NAGPUR'],
    });
    reconfirmed = confirmItem(reconfirmed, 'NAGPUR');
    expect(restoreHandover(reconfirmed)).toEqual(reconfirmed);
    expect(result(restoreHandover(reconfirmed), 'NAGPUR').confirmed).toBe(true);
  });

  it('applies the documented policy to model interpretations that cannot be re-run', () => {
    const local = parseTranscript({
      text: DEMO_TRANSCRIPTS['en-IN'].corrected,
      role: 'incoming',
      language: 'en-IN',
      items: createDemoHandover().items,
      utteranceId: 'model-readback',
    });
    let state = recordReadback(createDemoHandover(), { ...local, parser: 'model' });
    for (const item of state.items) state = confirmItem(state, item.id);

    // Validated under the current guards: kept.
    expect(restoreHandover(state)).toEqual(state);
    // Validated under older (unstamped) guards: cannot be re-verified offline, so reopened.
    const outdated = restoreHandover(withoutStamps(state));
    expect(outdated.confirmations).toEqual({});
    expect(outdated.readbacks).toEqual({});
    expect(outdated.recheckNotice?.itemIds).toEqual(['NAGPUR', 'J1', 'J2']);
    expect(restoreHandover(outdated)).toEqual(outdated);
  });

  it('reopens a current-stamped model reading that suppresses a current critical guard', () => {
    const text = 'I will send eight Nagpur parcels after 3 PM or hold them.';
    const demo = createDemoHandover();
    const local = parseTranscript({
      text,
      role: 'incoming',
      language: 'en-IN',
      items: demo.items,
      utteranceId: 'model-suppressed',
    });
    expect(local.issues.some((issue) => issue.code === 'COMPETING_ACTIONS')).toBe(true);
    const model: ParsedTranscript = {
      ...local,
      parser: 'model',
      issues: [],
      claims: local.claims.map((claim) => ({ ...claim, action: 'dispatch', uncertainFields: [] })),
    };
    let state = recordReadback(demo, model);
    state = confirmItem(state, 'NAGPUR');
    expect(state.utterances.at(-1)?.rulesVersion).toBe(INTERPRETATION_RULES_VERSION);
    const loaded = restoreHandover(state);
    expect(loaded.confirmations.NAGPUR).toBeUndefined();
    expect(loaded.recheckNotice?.itemIds).toContain('NAGPUR');
  });

  it('treats unverifiable or malformed revalidation context safely', () => {
    const saved = approvedUnderOldRules();
    const readback = saved.utterances.find((u) => u.utteranceId === 'readback-old-rules')!;
    // Parse-time context references an item revision with no surviving snapshot.
    readback.itemRevisions = { ...readback.itemRevisions, GHOST: 4 };
    saved.sourceReview = [
      {
        itemId: 'MISSING',
        itemRevision: 1,
        utteranceId: 'nowhere',
        reviewed: false,
        createdAt: saved.createdAt,
      },
    ];
    const loaded = restoreHandover(saved);
    expect(loaded.confirmations).toEqual({});
    expect(loaded.sourceReview).toBeUndefined();
    expect(restoreHandover(loaded)).toEqual(loaded);
    expect(() => restoreHandover({ ...saved, utterances: 'not a list' })).toThrow();
  });

  it('keeps a stamped read-back retry idempotent', () => {
    const demo = createDemoHandover();
    const parsed = parseTranscript({
      text: DEMO_TRANSCRIPTS['en-IN'].corrected,
      role: 'incoming',
      language: 'en-IN',
      items: demo.items,
      utteranceId: 'retry',
    });
    const once = recordReadback(demo, parsed);
    expect(recordReadback(once, parsed)).toBe(once);
  });
});
