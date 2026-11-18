import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoHandover, DEMO_TRANSCRIPTS } from '../../src/domain/fixtures';
import { confirmItem, submitReadback } from '../../src/domain/engine';
import type { HandoverState } from '../../src/domain/types';

// Counts interpretation work so the save path can be shown not to redo it.
const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/domain/parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/domain/parser')>();
  return {
    ...actual,
    parseTranscript: (input: Parameters<typeof actual.parseTranscript>[0]) => {
      parses.count += 1;
      return actual.parseTranscript(input);
    },
  };
});

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

const titled = (title: string): HandoverState => ({ ...createDemoHandover(), title });
const saved = (storage: Storage) =>
  JSON.parse(storage.getItem(KEY)!) as {
    writeCount: number;
    handovers: HandoverState[];
  };

describe('review finding 2: resetting unreadable data in several tabs', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never wipes another tab's newer work and never reuses a counter", async () => {
    storage.setItem(KEY, '{corrupt');
    const tabA = await openTab();
    const tabB = await openTab();
    expect(tabA.readWorkspace().warning).toBeTruthy();
    expect(tabB.readWorkspace().warning).toBeTruthy();

    expect(tabA.resetSavedWorkspace([titled('A work')], null)).toEqual({ ok: true });
    const afterA = saved(storage);
    expect(afterA.handovers[0]!.title).toBe('A work');

    // Tab B still shows the old unreadable warning and presses reset too.
    expect(tabB.resetSavedWorkspace([titled('B work')], null)).toEqual({
      ok: false,
      newer: true,
    });
    expect(storage.getItem(KEY)).toBe(JSON.stringify(afterA));
    // B adopts A's work instead and continues from there.
    const latest = tabB.readWorkspace();
    expect(latest.handovers[0]!.title).toBe('A work');
  });

  it('advances past every counter seen when replacing unreadable data', async () => {
    const first = await openTab();
    first.readWorkspace();
    expect(first.writeWorkspace([titled('v1')], null).ok).toBe(true);
    expect(first.writeWorkspace([titled('v2')], null).ok).toBe(true);
    const counter = saved(storage).writeCount;
    // Damaged later, but its counter is still legible.
    storage.setItem(KEY, storage.getItem(KEY)!.replace('"schemaVersion":1', '"schemaVersion":7'));
    const tab = await openTab();
    expect(tab.readWorkspace().warning).toBeTruthy();
    expect(tab.resetSavedWorkspace([titled('reset')], null)).toEqual({ ok: true });
    expect(saved(storage).writeCount).toBeGreaterThan(counter);
    // The first tab (counter 2) is now stale and cannot overwrite the reset.
    expect(first.hasNewerSavedWorkspace()).toBe(true);
    expect(first.writeWorkspace([titled('stale')], null).conflict).toBe(true);
    expect(saved(storage).handovers[0]!.title).toBe('reset');
  });

  it('detects different work saved under the same counter', async () => {
    const tabA = await openTab();
    tabA.readWorkspace();
    expect(tabA.writeWorkspace([titled('A')], null).ok).toBe(true);
    const tabB = await openTab();
    tabB.readWorkspace();
    // Another tab replaced the data and happened to reach the same counter.
    const other = await openTab();
    storage.removeItem(KEY);
    other.readWorkspace();
    expect(other.writeWorkspace([titled('other')], null).ok).toBe(true);
    expect(saved(storage).writeCount).toBe(1);
    expect(tabA.hasNewerSavedWorkspace()).toBe(true);
    expect(tabA.writeWorkspace([titled('A again')], null).conflict).toBe(true);
    expect(saved(storage).handovers[0]!.title).toBe('other');
  });
});

describe('review finding 6: saving does not reinterpret unchanged handovers', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reinterprets saved data on load only, not on every save or commit', async () => {
    let state = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
    for (const item of state.items) state = confirmItem(state, item.id);
    const many = Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(state), id: `h${i}` }));
    const writer = await openTab();
    expect(writer.writeWorkspace(many, 'h0').ok).toBe(true);

    const tab = await openTab();
    parses.count = 0;
    const loaded = tab.readWorkspace();
    expect(loaded.handovers).toHaveLength(10);
    expect(parses.count).toBeGreaterThan(0); // Load is a trust boundary.

    parses.count = 0;
    expect(tab.writeWorkspace(loaded.handovers, 'h1')).toEqual({ ok: true });
    expect(tab.writeWorkspace(loaded.handovers, 'h0')).toEqual({ ok: true });
    expect(parses.count).toBe(0);

    // An in-app commit that changes no interpretation rechecks nothing old.
    // (The tab's own engine module, as in the app.)
    const engine = await import('../../src/domain/engine');
    const current = loaded.handovers[0]!;
    parses.count = 0;
    const next = engine.restoreHandover({ ...current, title: 'Renamed' }, { previous: current });
    expect(parses.count).toBe(0);
    expect(tab.writeWorkspace([next, ...loaded.handovers.slice(1)], 'h0')).toEqual({ ok: true });
    expect(parses.count).toBe(0);
    expect(saved(storage).handovers[0]!.title).toBe('Renamed');
  });
});
