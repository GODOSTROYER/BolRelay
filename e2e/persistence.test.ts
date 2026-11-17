import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoHandover } from '../src/domain/fixtures';
import {
  readWorkspace,
  STORAGE_KEY,
  writeWorkspace,
  clearSavedWorkspace,
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
});
