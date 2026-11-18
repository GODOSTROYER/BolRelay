import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import { confirmItem, recordReadback, restoreHandover, reviseItem } from '../../src/domain/engine';
import { parseTranscript } from '../../src/domain/parser';
import type { HandoverState } from '../../src/domain/types';

type Persistence = typeof import('../../src/lib/persistence');
const KEY = 'bolrelay.workspace.v1';

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

/** Each tab is a separate document, so it gets its own module instance over shared storage. */
async function openTab(): Promise<Persistence> {
  vi.resetModules();
  return import('../../src/lib/persistence');
}

const saved = (storage: Storage) =>
  JSON.parse(storage.getItem(KEY)!) as { writeCount: number; handovers: HandoverState[] };

/**
 * Confirmed work whose saved reading of "thirty eight" (stored as 8 by an older
 * build) no longer matches the current rules, so every load rechecks it.
 */
function needsRecheck(): HandoverState {
  const base = createDemoHandover();
  const text =
    'I will send thirty eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.';
  const current = parseTranscript({
    text,
    role: 'incoming',
    language: 'en-IN',
    items: base.items,
    utteranceId: 'rb1',
  });
  let state = recordReadback(base, {
    ...current,
    claims: current.claims.map((claim) =>
      claim.itemIds.includes('NAGPUR') ? { ...claim, quantity: 8 } : claim,
    ),
  });
  for (const item of state.items) state = confirmItem(state, item.id);
  return state;
}

const roundTrip = (state: HandoverState) =>
  JSON.stringify(restoreHandover(JSON.parse(JSON.stringify(state))));

describe('final review N1: a recheck result is saved in a canonical form', () => {
  it('restoring an already rechecked state again gives byte-identical JSON', () => {
    const first = restoreHandover(JSON.parse(JSON.stringify(needsRecheck())));
    expect(first.recheckNotice?.itemIds).toContain('NAGPUR');
    expect(roundTrip(first)).toBe(JSON.stringify(first));
  });

  it('a state without participant languages keeps one key order across loads', () => {
    const legacy = JSON.parse(JSON.stringify(createDemoHandover())) as Partial<HandoverState>;
    delete legacy.participantLanguages;
    const first = restoreHandover(legacy);
    expect(roundTrip(first)).toBe(JSON.stringify(first));
  });

  it('an in-app change after a recheck keeps a canonical order', () => {
    const first = restoreHandover(JSON.parse(JSON.stringify(needsRecheck())));
    const next = restoreHandover(reviseItem(first, 'J1', { quantity: 3 }), { previous: first });
    expect(roundTrip(next)).toBe(JSON.stringify(next));
  });
});

describe('final review N1: opening another tab never makes an open tab stale', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  const seed = () => {
    const state = needsRecheck();
    storage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        handovers: [state],
        activeId: state.id,
        writeCount: 6,
        writeToken: 't0',
      }),
    );
  };

  it('a second and third tab loading rechecked data write nothing', async () => {
    seed();
    const tabA = await openTab();
    const a = tabA.readWorkspace();
    expect(a.handovers[0]!.confirmations.NAGPUR).toBeUndefined();
    expect(tabA.writeWorkspace(a.handovers, a.activeId)).toEqual({ ok: true });
    const afterA = storage.getItem(KEY);
    // The recheck is saved (the reopened confirmation is gone from storage) ...
    expect(saved(storage).handovers[0]!.confirmations.NAGPUR).toBeUndefined();
    // ... but it is derived from the saved data alone, so it is not new work.
    expect(saved(storage).writeCount).toBe(6);

    const tabB = await openTab();
    const b = tabB.readWorkspace();
    expect(tabB.writeWorkspace(b.handovers, b.activeId)).toEqual({ ok: true });
    expect(storage.getItem(KEY)).toBe(afterA);
    expect(tabA.hasNewerSavedWorkspace()).toBe(false);
    expect(tabA.writeWorkspace(a.handovers, a.activeId)).toEqual({ ok: true });

    const tabC = await openTab();
    const c = tabC.readWorkspace();
    expect(tabC.writeWorkspace(c.handovers, c.activeId)).toEqual({ ok: true });
    expect(saved(storage).writeCount).toBe(6);
    expect(tabB.hasNewerSavedWorkspace()).toBe(false);
  });

  it('reading the same saved text twice (as React may) still saves the recheck as known', async () => {
    seed();
    const tab = await openTab();
    const first = tab.readWorkspace();
    expect(tab.readWorkspace().handovers).toBe(first.handovers);
    expect(tab.writeWorkspace(first.handovers, first.activeId)).toEqual({ ok: true });
    expect(saved(storage).writeCount).toBe(6);
  });

  it('N7: two tabs loading the same data together both save their recheck without conflict', async () => {
    seed();
    const tabA = await openTab();
    const tabB = await openTab();
    const a = tabA.readWorkspace();
    const b = tabB.readWorkspace();
    // Each tab's recheck adds its own system event (ids and times differ).
    expect(JSON.stringify(a.handovers)).not.toBe(JSON.stringify(b.handovers));
    expect(tabA.writeWorkspace(a.handovers, a.activeId)).toEqual({ ok: true });
    expect(tabB.hasNewerSavedWorkspace()).toBe(false);
    expect(tabB.writeWorkspace(b.handovers, b.activeId)).toEqual({ ok: true });
    expect(tabA.hasNewerSavedWorkspace()).toBe(false);
    // Selecting another handover in A is still not new work.
    expect(tabA.writeWorkspace(a.handovers, null)).toEqual({ ok: true });
    expect(tabB.hasNewerSavedWorkspace()).toBe(false);
    expect(saved(storage).writeCount).toBe(6);
    expect(saved(storage).handovers[0]!.confirmations.NAGPUR).toBeUndefined();

    // A real change in A still makes B stale, and B cannot overwrite it.
    const edited = restoreHandover(reviseItem(a.handovers[0]!, 'J1', { quantity: 3 }), {
      previous: a.handovers[0]!,
    });
    expect(tabA.writeWorkspace([edited], a.activeId)).toEqual({ ok: true });
    expect(saved(storage).writeCount).toBe(7);
    expect(tabB.hasNewerSavedWorkspace()).toBe(true);
    expect(tabB.writeWorkspace(b.handovers, b.activeId)).toMatchObject({ conflict: true });
    expect(saved(storage).handovers[0]!.items.find((item) => item.id === 'J1')!.quantity).toBe(3);
  });
});
