import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoHandover, DEMO_TRANSCRIPTS } from '../../src/domain/fixtures';
import { confirmItem, releaseItem, submitReadback } from '../../src/domain/engine';
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

const agreed = () =>
  submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected) as HandoverState;
const writeCount = (storage: Storage) =>
  (JSON.parse(storage.getItem(KEY)!) as { writeCount?: number }).writeCount;

describe('P1: stale browser tabs cannot overwrite newer handovers', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a save from a tab whose loaded workspace is older than the saved one', async () => {
    const first = await openTab();
    const initial = agreed();
    expect(first.writeWorkspace([initial], initial.id)).toEqual({ ok: true });
    const tabA = await openTab();
    const tabB = await openTab();
    const loadedA = tabA.readWorkspace();
    const loadedB = tabB.readWorkspace();
    expect(tabA.hasNewerSavedWorkspace()).toBe(false);

    const newer = releaseItem(loadedB.handovers[0]!, 'J1');
    expect(tabB.writeWorkspace([newer], newer.id)).toEqual({ ok: true });
    const saved = storage.getItem(KEY);
    expect(tabA.hasNewerSavedWorkspace()).toBe(true);
    expect(tabB.hasNewerSavedWorkspace()).toBe(false);

    // Tab A still shows J1 at revision 1 and tries to confirm it.
    const stale = confirmItem(loadedA.handovers[0]!, 'J1', 'Isha', 1);
    const result = tabA.writeWorkspace([stale], stale.id);
    expect(result).toEqual({ ok: false, conflict: true, error: tabA.STALE_WORKSPACE_MESSAGE });
    expect(result.error).toMatch(/changed in another tab/);
    expect(storage.getItem(KEY)).toBe(saved);
    const latest = tabA.readWorkspace().handovers[0]!;
    expect(latest.items.find((item) => item.id === 'J1')!.revision).toBe(2);
    expect(latest.confirmations.J1).toBeUndefined();

    // After reloading, tab A is current again and tab B becomes the stale one.
    expect(tabA.hasNewerSavedWorkspace()).toBe(false);
    const fresh = confirmItem(latest, 'NAGPUR', 'Isha', 1);
    expect(tabA.writeWorkspace([fresh], fresh.id)).toEqual({ ok: true });
    expect(tabB.hasNewerSavedWorkspace()).toBe(true);
    expect(tabB.writeWorkspace([newer], newer.id).conflict).toBe(true);
  });

  it('does not advance the counter for unchanged content or a selection change', async () => {
    const tab = await openTab();
    const one = createDemoHandover();
    const two = { ...createDemoHandover('hi-IN'), id: 'demo-second' };
    expect(tab.writeWorkspace([one, two], one.id)).toEqual({ ok: true });
    expect(writeCount(storage)).toBe(1);
    const other = await openTab();
    const loaded = other.readWorkspace();
    // Opening another tab rewrites identical data: nothing is written and no tab goes stale.
    expect(other.writeWorkspace(loaded.handovers, loaded.activeId)).toEqual({ ok: true });
    expect(tab.writeWorkspace([one, two], two.id)).toEqual({ ok: true });
    expect(writeCount(storage)).toBe(1);
    expect(JSON.parse(storage.getItem(KEY)!).activeId).toBe(two.id);
    expect(other.hasNewerSavedWorkspace()).toBe(false);
    expect(tab.hasNewerSavedWorkspace()).toBe(false);
  });

  it('migrates saved data written before the counter existed', async () => {
    // Data saved by an older build: same normalized handovers, no counter field.
    const legacy = createDemoHandover();
    (await openTab()).writeWorkspace([legacy], legacy.id);
    const { writeCount: _dropped, ...older } = JSON.parse(storage.getItem(KEY)!);
    storage.setItem(KEY, JSON.stringify(older));
    const tabA = await openTab();
    const tabB = await openTab();
    expect(tabA.readWorkspace().warning).toBeNull();
    tabB.readWorkspace();
    expect(tabA.hasNewerSavedWorkspace()).toBe(false);
    // Identical content only adds the counter field and keeps both tabs current.
    expect(tabA.writeWorkspace([legacy], legacy.id)).toEqual({ ok: true });
    expect(writeCount(storage)).toBe(0);
    expect(tabB.hasNewerSavedWorkspace()).toBe(false);
    const changed = agreed();
    expect(tabA.writeWorkspace([changed], changed.id)).toEqual({ ok: true });
    expect(writeCount(storage)).toBe(1);
    expect(tabB.writeWorkspace([legacy], legacy.id).conflict).toBe(true);
  });

  it('a restore in one tab invalidates every other tab and ignores the backup counter', async () => {
    const tabA = await openTab();
    const example = agreed();
    tabA.writeWorkspace([example], example.id);
    const tabB = await openTab();
    tabB.readWorkspace();
    const backup = JSON.stringify({
      version: 1,
      handovers: [createDemoHandover('mr-IN')],
      activeId: null,
      writeCount: 0,
    });
    tabB.restoreWorkspaceBackup(backup);
    expect(writeCount(storage)).toBe(2);
    expect(tabA.hasNewerSavedWorkspace()).toBe(true);
    expect(tabA.writeWorkspace([example], example.id).conflict).toBe(true);
    expect(tabB.hasNewerSavedWorkspace()).toBe(false);
    // Previewing a backup file never changes the counter.
    await tabA.importWorkspaceBackup(new File([backup], 'backup.json'));
    expect(writeCount(storage)).toBe(2);
  });

  it('keeps the existing recovery paths for unreadable and unavailable storage', async () => {
    const tab = await openTab();
    storage.setItem(KEY, '{ "unfinished');
    expect(tab.readWorkspace().warning).toBeTruthy();
    expect(tab.hasNewerSavedWorkspace()).toBe(false);
    const example = createDemoHandover();
    const unreadable = tab.writeWorkspace([example], example.id);
    expect(unreadable.ok).toBe(false);
    expect(unreadable.conflict).toBeUndefined();
    expect(storage.getItem(KEY)).toBe('{ "unfinished');
    tab.clearSavedWorkspace();
    expect(tab.writeWorkspace([example], example.id)).toEqual({ ok: true });

    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(tab.hasNewerSavedWorkspace()).toBe(false);
    const unavailable = tab.writeWorkspace([example], example.id);
    expect(unavailable.ok).toBe(false);
    expect(unavailable.conflict).toBeUndefined();
    expect(unavailable.error).toMatch(/memory|unavailable/i);
  });

  it('a failed write does not advance this tab past the saved counter', async () => {
    const tab = await openTab();
    const example = createDemoHandover();
    tab.writeWorkspace([example], example.id);
    const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const changed = agreed();
    expect(tab.writeWorkspace([changed], changed.id).ok).toBe(false);
    spy.mockRestore();
    expect(tab.hasNewerSavedWorkspace()).toBe(false);
    expect(tab.writeWorkspace([changed], changed.id)).toEqual({ ok: true });
    expect(writeCount(storage)).toBe(2);
  });
});
