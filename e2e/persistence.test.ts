import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoHandover, DEMO_TRANSCRIPTS } from '../src/domain/fixtures';
import { confirmItem, submitReadback } from '../src/domain/engine';
import {
  readWorkspace,
  STORAGE_KEY,
  writeWorkspace,
  clearSavedWorkspace,
  parseWorkspaceBackup,
  importWorkspaceBackup,
  restoreWorkspaceBackup,
} from '../src/lib/persistence';

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

describe('workspace recovery and persistence contract', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts empty without manufacturing a storage error', () => {
    expect(readWorkspace()).toEqual({ handovers: [], activeId: null, warning: null });
  });

  it('preserves malformed original bytes and blocks implicit overwrite', () => {
    const original = '{ "unfinished": "original data';
    storage.setItem(STORAGE_KEY, original);
    expect(readWorkspace().warning).toBeTruthy();
    const example = createDemoHandover();
    expect(writeWorkspace([example], example.id).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });

  it('allows replacement only after explicit recovery clears saved data', () => {
    storage.setItem(STORAGE_KEY, 'invalid');
    clearSavedWorkspace();
    const example = createDemoHandover();
    expect(writeWorkspace([example], example.id).ok).toBe(true);
    expect(readWorkspace().activeId).toBe(example.id);
    expect(readWorkspace().warning).toBeNull();
  });

  it('round-trips current instruction identities and revisions', () => {
    const example = createDemoHandover();
    expect(writeWorkspace([example], example.id)).toEqual({ ok: true });
    const saved = readWorkspace();
    expect(saved.handovers).toEqual([example]);
    expect(saved.activeId).toBe(example.id);
  });

  it('recovers a missing selected handover without discarding valid handovers', () => {
    const example = createDemoHandover();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, handovers: [example], activeId: 'missing' }),
    );
    expect(readWorkspace().activeId).toBe(example.id);
    expect(readWorkspace().handovers).toHaveLength(1);
    expect(readWorkspace().warning).toBeNull();
  });

  it('rejects duplicate handover identities instead of creating ambiguous selection', () => {
    const example = createDemoHandover();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, handovers: [example, example], activeId: example.id }),
    );
    expect(readWorkspace().warning).toBeTruthy();
    expect(readWorkspace().handovers).toEqual([]);
  });

  it('reports unavailable storage without claiming the current work was saved', () => {
    const example = createDemoHandover();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const result = writeWorkspace([example], example.id);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/memory|unavailable|full/i);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects unsupported future storage schemas without overwriting them', () => {
    const original = JSON.stringify({ version: 99, handovers: [], activeId: null });
    storage.setItem(STORAGE_KEY, original);
    expect(readWorkspace().warning).toBeTruthy();
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });

  it('validates a complete workspace backup before explicit restore', async () => {
    const example = createDemoHandover('hi-IN');
    const raw = JSON.stringify({ version: 1, handovers: [example], activeId: example.id });
    storage.setItem(STORAGE_KEY, 'original recovery bytes');
    const preview = await importWorkspaceBackup(new File([raw], 'workspace.json'));
    expect(preview.handovers).toEqual([example]);
    expect(storage.getItem(STORAGE_KEY)).toBe('original recovery bytes');
    expect(restoreWorkspaceBackup(raw)).toEqual(preview);
    expect(readWorkspace()).toEqual(preview);
  });

  it('a malformed or inconsistent backup cannot overwrite existing work', () => {
    const example = createDemoHandover();
    writeWorkspace([example], example.id);
    const original = storage.getItem(STORAGE_KEY);
    expect(() => restoreWorkspaceBackup('{invalid')).toThrow();
    const corrupt = structuredClone(example);
    corrupt.items[0]!.evidence[0]!.utteranceId = 'missing';
    expect(() =>
      restoreWorkspaceBackup(
        JSON.stringify({ version: 1, handovers: [corrupt], activeId: corrupt.id }),
      ),
    ).toThrow();
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });

  it('accepts legacy raw workspace backups and migrates participant preferences', () => {
    const { participantLanguages: _preferences, ...legacy } = createDemoHandover('mr-IN');
    const restored = parseWorkspaceBackup(
      JSON.stringify({ version: 1, handovers: [legacy], activeId: legacy.id }),
    );
    expect(restored.handovers[0]?.participantLanguages).toEqual({
      outgoing: 'mr-IN',
      incoming: 'mr-IN',
    });
  });

  it('persists legacy recheck migration without blocking saves or repeating system events', () => {
    let legacy = submitReadback(createDemoHandover(), DEMO_TRANSCRIPTS['en-IN'].corrected);
    for (const item of legacy.items) legacy = confirmItem(legacy, item.id);
    for (const utterance of legacy.utterances)
      if (utterance.role === 'incoming') delete utterance.readbackMode;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, handovers: [legacy], activeId: legacy.id }),
    );
    const recovered = readWorkspace();
    expect(recovered.warning).toBeNull();
    expect(recovered.handovers[0]?.recheckNotice?.itemIds).toHaveLength(3);
    expect(recovered.handovers[0]?.confirmations).toEqual({});
    expect(writeWorkspace(recovered.handovers, recovered.activeId)).toEqual({ ok: true });
    expect(readWorkspace()).toEqual(recovered);
    // Direct callers of writeWorkspace also persist the validated migration.
    expect(writeWorkspace([legacy], legacy.id)).toEqual({ ok: true });
    const encoded = JSON.parse(storage.getItem(STORAGE_KEY)!) as {
      handovers: { confirmations: Record<string, unknown>; recheckNotice?: unknown }[];
    };
    expect(encoded.handovers[0]?.confirmations).toEqual({});
    expect(encoded.handovers[0]?.recheckNotice).toBeTruthy();
    const saved = readWorkspace();
    expect(writeWorkspace(saved.handovers, saved.activeId)).toEqual({ ok: true });
    expect(readWorkspace()).toEqual(saved);
  });
});
