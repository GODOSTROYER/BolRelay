import { z } from 'zod';
import { handoverStateSchema } from '../domain/schema';
import { restoreHandover } from '../domain/engine';
import type { HandoverState } from '../domain/types';

export const STORAGE_KEY = 'bolrelay.workspace.v1';
export const MAX_WORKSPACE_CHARACTERS = 4_000_000;
// UTF-8 can use three bytes per UTF-16 code unit for Hindi/Marathi text.
const MAX_WORKSPACE_FILE_BYTES = MAX_WORKSPACE_CHARACTERS * 3;
const workspaceSchema = z.object({
  version: z.literal(1),
  handovers: z.array(handoverStateSchema).max(40),
  activeId: z.string().nullable(),
  // Additive: saved data from before cross-tab protection has no counter and reads as 0.
  writeCount: z.number().int().nonnegative().optional(),
});

/** Shown when another tab saved newer work after this tab last loaded or wrote. */
export const STALE_WORKSPACE_MESSAGE =
  'This handover changed in another tab — reload to see the latest. Editing here is paused; text you typed is kept.';

// The write counter this tab (document) last loaded or wrote. Every save is a
// compare-and-set against it, so a stale tab can never replace newer work.
let knownWriteCount = 0;

function storedWriteCount(raw: string): number {
  const value = (JSON.parse(raw) as { writeCount?: unknown }).writeCount;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * True when saved data exists and another tab has written it since this tab last
 * loaded or saved. Unreadable or unavailable storage is reported by the existing
 * recovery paths instead.
 */
export function hasNewerSavedWorkspace(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && storedWriteCount(raw) !== knownWriteCount;
  } catch {
    return false;
  }
}

export interface WorkspaceSnapshot {
  handovers: HandoverState[];
  activeId: string | null;
  warning: string | null;
}

/** Pure validation used for both local persistence and an explicit backup restore. */
export function parseWorkspaceBackup(raw: string): WorkspaceSnapshot {
  if (raw.length > MAX_WORKSPACE_CHARACTERS)
    throw new Error('This workspace backup exceeds the supported 4 million character limit.');
  const data = workspaceSchema.parse(JSON.parse(raw));
  if (new Set(data.handovers.map((handover) => handover.id)).size !== data.handovers.length)
    throw new Error('This workspace backup contains duplicate handover identifiers.');
  const handovers = data.handovers.map(restoreHandover);
  return {
    handovers,
    activeId: handovers.some((handover) => handover.id === data.activeId)
      ? data.activeId
      : (handovers[0]?.id ?? null),
    warning: null,
  };
}

/** Reads a workspace backup without changing either the current UI or saved data. */
export async function importWorkspaceBackup(file: File): Promise<WorkspaceSnapshot> {
  if (file.size > MAX_WORKSPACE_FILE_BYTES)
    throw new Error('Choose a BolRelay workspace backup no larger than 12 MB.');
  try {
    return parseWorkspaceBackup(await file.text());
  } catch {
    throw new Error(
      'This is not a valid BolRelay workspace backup. Your current workspace has not changed.',
    );
  }
}

/** Explicit replacement only: validate the complete backup before touching saved data. */
export function restoreWorkspaceBackup(raw: string): WorkspaceSnapshot {
  const restored = parseWorkspaceBackup(raw);
  // A restore is an explicit replacement; it always advances past every counter
  // seen so far so other open tabs become stale. The backup's own counter is ignored.
  let previous = knownWriteCount;
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) previous = Math.max(previous, storedWriteCount(current));
  } catch {
    // Unreadable original data is being explicitly replaced.
  }
  const writeCount = previous + 1;
  const serialized = JSON.stringify({
    version: 1,
    handovers: restored.handovers,
    activeId: restored.activeId,
    writeCount,
  });
  if (serialized.length > MAX_WORKSPACE_CHARACTERS)
    throw new Error(
      'This restored workspace is too large to save. Your current workspace has not changed.',
    );
  localStorage.setItem(STORAGE_KEY, serialized);
  knownWriteCount = writeCount;
  return restored;
}

const UNREADABLE_WARNING =
  'Saved data could not be read. The original data is still in this browser. Export or clear it before saving a new workspace.';

/** Loads saved data and records its write counter as this tab's baseline. */
export function readWorkspace(): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { handovers: [], activeId: null, warning: null };
    const snapshot = parseWorkspaceBackup(raw);
    knownWriteCount = storedWriteCount(raw);
    return snapshot;
  } catch {
    return {
      handovers: [],
      activeId: null,
      warning: UNREADABLE_WARNING,
    };
  }
}

/**
 * Compare-and-set save: writes only when the saved write counter still equals the
 * one this tab last loaded or wrote. A conflict leaves saved data untouched.
 */
export function writeWorkspace(
  handovers: HandoverState[],
  activeId: string | null,
): { ok: boolean; error?: string; conflict?: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let savedHandovers: string | null = null;
    if (raw) {
      try {
        parseWorkspaceBackup(raw);
      } catch {
        return { ok: false, error: UNREADABLE_WARNING };
      }
      if (storedWriteCount(raw) !== knownWriteCount)
        return { ok: false, conflict: true, error: STALE_WORKSPACE_MESSAGE };
      savedHandovers = JSON.stringify((JSON.parse(raw) as { handovers: unknown }).handovers);
    }
    const data = workspaceSchema.parse({ version: 1, handovers, activeId });
    data.handovers = data.handovers.map(restoreHandover);
    if (new Set(handovers.map((h) => h.id)).size !== handovers.length)
      throw new Error('Duplicate handover identifiers.');
    // Only a change to handover content advances the counter. Selecting another
    // handover or reopening a tab must not make other tabs stale.
    const writeCount =
      savedHandovers === JSON.stringify(data.handovers) ? knownWriteCount : knownWriteCount + 1;
    const serialized = JSON.stringify({ ...data, writeCount });
    if (serialized.length > MAX_WORKSPACE_CHARACTERS)
      return {
        ok: false,
        error: 'This workspace is full. Export and remove older handovers to keep saving.',
      };
    if (serialized !== raw) localStorage.setItem(STORAGE_KEY, serialized);
    knownWriteCount = writeCount;
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
