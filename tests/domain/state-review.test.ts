import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  confirmItem,
  createDemoHandover,
  createHandover,
  DEMO_TRANSCRIPTS,
  parseTranscript,
  recordReadback,
  releaseItem,
  removeItem,
  restoreHandover,
  reviseItem,
  setParticipantLanguage,
  submitReadback,
} from '../../src/domain';
import { importHandover, serializeHandoverExport } from '../../src/lib/export';
import type { HandoverState } from '../../src/domain';

const result = (state: HandoverState, id: string) =>
  compareHandover(state).find((item) => item.itemId === id)!;
function confirmedState() {
  let state = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
  for (const item of state.items) state = confirmItem(state, item.id);
  return state;
}

function legacyConfirmedState() {
  const state = confirmedState();
  for (const utterance of state.utterances) {
    if (utterance.role !== 'incoming') continue;
    delete utterance.readbackMode;
    delete utterance.scopeItemIds;
  }
  return state;
}

describe('legacy interpretation approval migration', () => {
  it('preserves original statements and history while reopening earlier approvals once', () => {
    const legacy = legacyConfirmedState();
    const restored = restoreHandover(legacy);
    expect(restored.items).toEqual(legacy.items);
    expect(restored.utterances).toEqual(legacy.utterances);
    expect(restored.events.slice(0, legacy.events.length)).toEqual(legacy.events);
    expect(restored.readbacks).toEqual({});
    expect(restored.confirmations).toEqual({});
    expect(compareHandover(restored).every((item) => item.status === 'omission')).toBe(true);
    expect(restored.recheckNotice).toMatchObject({
      reason: 'legacy-interpretation',
      itemIds: Object.keys(legacy.readbacks),
    });
    expect(restored.events.at(-1)).toMatchObject({
      type: 'interpretation-upgraded',
      itemIds: Object.keys(legacy.readbacks),
    });
    expect(restored.events.at(-1)?.message).toMatch(/System update.*fresh check/);
    expect(restoreHandover(restored)).toEqual(restored);
    expect(Object.keys(legacy.confirmations)).toHaveLength(3);
  });

  it('invalidates only active legacy results, retaining a newer targeted acknowledgement', () => {
    let mixed = submitReadback(
      legacyConfirmedState(),
      'I will send eight Nagpur parcels after 3 PM.',
      { scopeItemIds: ['NAGPUR'] },
    );
    mixed = confirmItem(mixed, 'NAGPUR');
    const restored = restoreHandover(mixed);
    expect(restored.readbacks).toEqual({ NAGPUR: mixed.readbacks.NAGPUR });
    expect(restored.confirmations).toEqual({ NAGPUR: mixed.confirmations.NAGPUR });
    expect(result(restored, 'NAGPUR').confirmed).toBe(true);
    expect(restored.recheckNotice?.itemIds).toEqual(['J1', 'J2']);
  });

  it('clears notice items only when newly rechecked or deliberately removed', () => {
    const restored = restoreHandover(legacyConfirmedState());
    const targeted = submitReadback(restored, 'I will send eight Nagpur parcels after 3 PM.', {
      scopeItemIds: ['NAGPUR'],
    });
    expect(targeted.recheckNotice?.itemIds).toEqual(['J1', 'J2']);
    const removed = removeItem(targeted, 'J1');
    expect(removed.recheckNotice?.itemIds).toEqual(['J2']);
    expect(() => restoreHandover(removed)).not.toThrow();
    expect(removeItem(removed, 'J2').recheckNotice).toBeUndefined();
    const full = submitReadback(restored, DEMO_TRANSCRIPTS['en-IN'].corrected);
    expect(full.recheckNotice).toBeUndefined();
    expect(full.confirmations).toEqual({});
    expect(restoreHandover(full).recheckNotice).toBeUndefined();
  });

  it('leaves current read-backs, outgoing-only boards, and manual boards unchanged', () => {
    const modern = confirmedState();
    const outgoing = createDemoHandover();
    const manual = createHandover({
      items: [
        {
          id: 'P7',
          label: 'Pune',
          quantity: 5,
          unit: 'parcels',
          action: 'dispatch',
          notBefore: '09:00',
          condition: null,
          owner: null,
        },
      ],
    });
    for (const state of [modern, outgoing, manual]) {
      expect(restoreHandover(state)).toEqual(state);
      expect(restoreHandover(state).recheckNotice).toBeUndefined();
    }
  });

  it('also reopens legacy model results from before the interpretation boundary update', () => {
    const state = legacyConfirmedState();
    for (const utterance of state.utterances)
      if (utterance.role === 'incoming') utterance.parser = 'model';
    const restored = restoreHandover(state);
    expect(restored.readbacks).toEqual({});
    expect(restored.confirmations).toEqual({});
    expect(restored.utterances).toEqual(state.utterances);
    expect(restored.recheckNotice?.reason).toBe('legacy-interpretation');
  });

  it.each(['claims', 'confirmation'] as const)(
    'rejects inconsistent legacy %s before migrating approvals',
    (kind) => {
      const state = legacyConfirmedState();
      if (kind === 'claims') state.readbacks.NAGPUR!.claims[0]!.quantity = 9;
      else state.confirmations.NAGPUR!.utteranceId = 'unrelated-recording';
      expect(() => restoreHandover(state)).toThrow(/read-back|recording|confirmation/);
    },
  );

  it('keeps a full supported history and persists the notice without overflowing it', () => {
    const legacy = legacyConfirmedState();
    while (legacy.events.length < 5_000)
      legacy.events.push({ ...legacy.events[0]!, id: `history-${legacy.events.length}` });
    const restored = restoreHandover(legacy);
    expect(restored.events).toEqual(legacy.events);
    expect(restored.readbacks).toEqual({});
    expect(restored.recheckNotice?.itemIds).toHaveLength(3);
    expect(restoreHandover(restored)).toEqual(restored);
  });
});

describe('reviewed state and source boundaries', () => {
  it('a full recheck reopens items omitted from the new account', () => {
    const old = confirmedState();
    const updated = submitReadback(old, 'I will send eight Nagpur parcels after 3 PM.');
    expect(result(updated, 'NAGPUR').status).toBe('agreement');
    expect(result(updated, 'J1').status).toBe('omission');
    expect(result(updated, 'J2').status).toBe('omission');
    expect(Object.keys(updated.confirmations)).toEqual([]);
    expect(updated.utterances.at(-1)?.readbackMode).toBe('full');
    expect(() => restoreHandover(updated)).not.toThrow();
  });

  it('a targeted reply updates only its explicit scope and survives restore', () => {
    const old = confirmedState();
    const changed = releaseItem(old, 'J1');
    const updated = submitReadback(changed, 'I will send one parcel J1.', { scopeItemIds: ['J1'] });
    expect(result(updated, 'J1').status).toBe('agreement');
    expect(result(updated, 'J1').confirmed).toBe(false);
    expect(result(updated, 'J2').confirmed).toBe(true);
    expect(result(updated, 'NAGPUR').confirmed).toBe(true);
    expect(updated.utterances.at(-1)?.readbackMode).toBe('targeted');
    expect(updated.utterances.at(-1)?.scopeItemIds).toEqual(['J1']);
    expect(() => restoreHandover(updated)).not.toThrow();
  });

  it('retains targeting metadata when extraction and recording are separate', () => {
    const old = confirmedState();
    const parsed = parseTranscript({
      text: 'I will hold one parcel J1 until the address is confirmed.',
      role: 'incoming',
      language: 'en-IN',
      items: old.items,
      scopeItemIds: ['J1'],
    });
    const updated = recordReadback(old, parsed, { scopeItemIds: ['J1'] });
    expect(result(updated, 'J2').confirmed).toBe(true);
    expect(updated.utterances.at(-1)?.scopeItemIds).toEqual(['J1']);
  });

  it('rejects missing/invalid targeting and contradictory extraction scope', () => {
    const old = confirmedState();
    const parsed = parseTranscript({
      text: DEMO_TRANSCRIPTS['en-IN'].corrected,
      role: 'incoming',
      language: 'en-IN',
      items: old.items,
    });
    expect(() => recordReadback(old, parsed, { mode: 'targeted' })).toThrow(
      /scope|selected|explicit/i,
    );
    expect(() => recordReadback(old, parsed, { scopeItemIds: ['missing'] })).toThrow(
      /scope|selected|explicit/i,
    );
    expect(() => recordReadback(old, parsed, { mode: 'full', scopeItemIds: ['J1'] })).toThrow(
      /scope|selected|explicit/i,
    );
    expect(() =>
      recordReadback(old, { ...parsed, readbackMode: 'targeted', scopeItemIds: ['J1'] }),
    ).toThrow(/another item|scope/i);
  });

  it('language preferences persist independently without changing instruction approvals', () => {
    const original = confirmedState();
    const changed = setParticipantLanguage(
      setParticipantLanguage(original, 'outgoing', 'mr-IN'),
      'incoming',
      'hi-IN',
    );
    expect(changed.participantLanguages).toEqual({ outgoing: 'mr-IN', incoming: 'hi-IN' });
    expect(changed.items).toEqual(original.items);
    expect(changed.confirmations).toEqual(original.confirmations);
    expect(restoreHandover(JSON.parse(JSON.stringify(changed))).participantLanguages).toEqual(
      changed.participantLanguages,
    );
  });

  it('migrates legacy participant language preferences from the stored handover language', () => {
    const { participantLanguages: _preferences, ...legacy } = createDemoHandover('mr-IN');
    expect(restoreHandover(legacy).participantLanguages).toEqual({
      outgoing: 'mr-IN',
      incoming: 'mr-IN',
    });
  });

  it.each(['missing source', 'incoming source', 'wrong item', 'wrong offsets'])(
    'rejects inconsistent current outgoing evidence: %s',
    (kind) => {
      const state = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
      const j1 = state.items.find((item) => item.id === 'J1')!;
      if (kind === 'missing source')
        j1.evidence = [
          { utteranceId: 'nonexistent', start: 0, end: 25, text: 'This quote was never said' },
        ];
      if (kind === 'incoming source')
        j1.evidence = [
          state.utterances.at(-1)!.claims.find((claim) => claim.itemIds.includes('J1'))!.evidence,
        ];
      if (kind === 'wrong item') j1.evidence = state.items[0]!.evidence;
      if (kind === 'wrong offsets')
        j1.evidence = j1.evidence.map((evidence) => ({
          ...evidence,
          start: evidence.start + 1,
          end: evidence.end + 1,
        }));
      expect(() => restoreHandover(state)).toThrow(/outgoing|source|recording|supported/i);
    },
  );

  it('labels only fields in a partial spoken edit and preserves original history', () => {
    const initial = createDemoHandover();
    const source = parseTranscript({
      text: 'Send one parcel J1.',
      role: 'outgoing',
      language: 'en-IN',
      items: initial.items,
    });
    let revised = reviseItem(initial, 'J1', {
      action: 'dispatch',
      evidence: [source.claims[0]!.evidence],
    });
    revised = {
      ...revised,
      utterances: [...revised.utterances, { ...source, createdAt: revised.updatedAt }],
    };
    const item = revised.items.find((candidate) => candidate.id === 'J1')!;
    expect(item.evidenceFields).toEqual(['action']);
    expect(item.condition).toBe('address confirmed');
    expect(revised.events.at(-1)?.before?.[0]?.evidence.length).toBeGreaterThan(0);
    expect(() => restoreHandover(revised)).not.toThrow();
    const falselyAttributed = structuredClone(revised);
    falselyAttributed.items
      .find((candidate) => candidate.id === 'J1')!
      .evidenceFields!.push('condition');
    expect(() => restoreHandover(falselyAttributed)).toThrow(/field|excerpt|support/i);
    const manual = reviseItem(revised, 'J1', { quantity: 2 });
    expect(manual.items.find((candidate) => candidate.id === 'J1')?.evidence).toEqual([]);
    expect(manual.items.find((candidate) => candidate.id === 'J1')?.evidenceFields).toEqual([]);
  });

  it('round-trips a valid export larger than the old 1 MB import limit', async () => {
    let state = createDemoHandover();
    const text =
      DEMO_TRANSCRIPTS['en-IN'].corrected.replace(/\.$/, '') + ' ' + 'acknowledged '.repeat(800);
    for (let i = 0; i < 55; i++) state = submitReadback(state, text);
    const encoded = serializeHandoverExport(state);
    const file = new File([encoded], 'handover.json', { type: 'application/json' });
    expect(file.size).toBeGreaterThan(1_000_000);
    expect(await importHandover(file)).toEqual(state);
  });
});
