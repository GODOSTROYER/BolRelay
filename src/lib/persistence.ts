import { z } from 'zod';
import { handoverStateSchema } from '../domain/schema';
import { restoreHandover } from '../domain/engine';
import type { HandoverState } from '../domain/types';

export const STORAGE_KEY = 'bolrelay.workspace.v1';
const MAX_WORKSPACE_BYTES = 4_000_000;
const workspaceSchema = z.object({
  version: z.literal(1),
  handovers: z.array(handoverStateSchema).max(40),
  activeId: z.string().nullable(),
});

export interface WorkspaceSnapshot {
  handovers: HandoverState[];
  activeId: string | null;
  warning: string | null;
}

export function readWorkspace(): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { handovers: [], activeId: null, warning: null };
    if (raw.length > MAX_WORKSPACE_BYTES) throw new Error('size');
    const data = workspaceSchema.parse(JSON.parse(raw));
    if (new Set(data.handovers.map((h) => h.id)).size !== data.handovers.length)
      throw new Error('duplicate');
    return {
      handovers: data.handovers.map(restoreHandover),
      activeId: data.handovers.some((h) => h.id === data.activeId)
        ? data.activeId
        : (data.handovers[0]?.id ?? null),
      warning: null,
    };
  } catch {
    return {
      handovers: [],
      activeId: null,
      warning:
        'Saved data could not be read. The original data is still in this browser. Export or clear it before saving a new workspace.',
    };
  }
}

export function writeWorkspace(
  handovers: HandoverState[],
  activeId: string | null,
): { ok: boolean; error?: string } {
  try {
    const current = readWorkspace();
    if (current.warning) return { ok: false, error: current.warning };
    const data = workspaceSchema.parse({ version: 1, handovers, activeId });
    for (const handover of data.handovers) restoreHandover(handover);
    if (new Set(handovers.map((h) => h.id)).size !== handovers.length)
      throw new Error('Duplicate handover identifiers.');
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_WORKSPACE_BYTES)
      return {
        ok: false,
        error: 'This workspace is full. Export and remove older handovers to keep saving.',
      };
    localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'Changes are currently only in memory. Browser storage is unavailable or full; export this handover before closing.',
    };
  }
}

/** A user-initiated recovery action. Never called automatically on parse failure. */
export function clearSavedWorkspace(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function downloadStoredWorkspace(): void {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return;
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bolrelay-workspace-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DB_NAME = 'bolrelay-recordings';
function audioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis))
      return reject(new Error('Recording storage is unavailable in this browser.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings');
    req.onerror = () => reject(new Error('Recording storage could not be opened.'));
    req.onblocked = () =>
      reject(new Error('Close other BolRelay tabs to update recording storage.'));
    req.onsuccess = () => resolve(req.result);
  });
}

export async function saveAudio(utteranceId: string, blob: Blob): Promise<void> {
  if (blob.size > 15_000_000)
    throw new Error(
      'This recording is too large to save. Keep each handover note under two minutes.',
    );
  const db = await audioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(blob, utteranceId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('The transcript was kept, but audio could not be saved.'));
    };
  });
}

export async function getAudio(utteranceId: string): Promise<Blob | null> {
  const db = await audioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').get(utteranceId);
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
    req.onerror = () => reject(new Error('The recording could not be loaded.'));
    tx.oncomplete = () => db.close();
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('The recording could not be loaded.'));
    };
  });
}

export async function removeAudio(utteranceIds: string[]): Promise<void> {
  if (utteranceIds.length === 0) return;
  const db = await audioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    for (const id of utteranceIds) tx.objectStore('recordings').delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('Some saved audio could not be deleted.'));
    };
  });
}
