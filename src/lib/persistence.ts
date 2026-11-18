import { z } from 'zod';
import { handoverStateSchema } from '../domain/schema';
import { isRestoredHandover, restoreHandover, type RestoreOptions } from '../domain/engine';
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
  // Random per content write, so two tabs that reach the same counter (for
  // example both resetting unreadable data) still conflict instead of colliding.
  writeToken: z.string().max(100).optional(),
});

/** Shown when another tab saved newer work after this tab last loaded or wrote. */
export const STALE_WORKSPACE_MESSAGE =
  'This handover changed in another tab — reload to see the latest. Editing here is paused; text you typed is kept.';

// The write counter and token this tab (document) last loaded or wrote. Every
// save is a compare-and-set against them, so a stale tab can never replace newer work.
let knownWriteCount = 0;
let knownWriteToken: string | undefined;
// The exact valid saved text this tab last loaded or wrote, and its handovers
// as JSON. Saved text equal to it needs no new validation.
let knownRaw: string | null = null;
let knownHandoversJson: string | null = null;
// The saved text this tab last saw, readable or not. A reset only replaces
// unreadable data that the person was actually shown.
let seenRaw: string | null = null;
// Other in-memory handover objects already validated by a save, and their
// validated form. React state is never mutated in place, so an unchanged
// object needs no second validation.
const validatedHandovers = new WeakMap<HandoverState, HandoverState>();

function storedWriteCount(raw: string): number {
  const value = (JSON.parse(raw) as { writeCount?: unknown }).writeCount;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

interface WriteStamp {
  count: number;
  token: string | undefined;
}

function stampOf(data: { writeCount?: unknown; writeToken?: unknown }): WriteStamp {
  const count = data.writeCount;
  return {
    count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0,
    token: typeof data.writeToken === 'string' ? data.writeToken : undefined,
  };
}

function storedWriteStamp(raw: string): WriteStamp {
  return stampOf(JSON.parse(raw) as { writeCount?: unknown; writeToken?: unknown });
}

function isNewer(raw: string): boolean {
  if (raw === knownRaw) return false;
  const stamp = storedWriteStamp(raw);
  return stamp.count !== knownWriteCount || stamp.token !== knownWriteToken;
}

function remember(raw: string, handoversJson: string, stamp: WriteStamp) {
  knownWriteCount = stamp.count;
  knownWriteToken = stamp.token;
  knownRaw = raw;
  seenRaw = raw;
  knownHandoversJson = handoversJson;
}

/**
 * True when saved data exists and another tab has written it since this tab last
 * loaded or saved. Unreadable or unavailable storage is reported by the existing
 * recovery paths instead.
 */
export function hasNewerSavedWorkspace(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && isNewer(raw);
  } catch {
    return false;
  }
}

export interface WorkspaceSnapshot {
  handovers: HandoverState[];
  activeId: string | null;
  warning: string | null;
}

/**
 * Pure validation used for both local persistence and an explicit backup restore.
 * A backup file is untrusted (`origin: 'import'`); this browser's own saved data
 * is the default.
 */
export function parseWorkspaceBackup(raw: string, options: RestoreOptions = {}): WorkspaceSnapshot {
  if (raw.length > MAX_WORKSPACE_CHARACTERS)
    throw new Error('This workspace backup exceeds the supported 4 million character limit.');
  const data = workspaceSchema.parse(JSON.parse(raw));
  if (new Set(data.handovers.map((handover) => handover.id)).size !== data.handovers.length)
    throw new Error('This workspace backup contains duplicate handover identifiers.');
  const handovers = data.handovers.map((handover) => restoreHandover(handover, options));
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
    return parseWorkspaceBackup(await file.text(), { origin: 'import' });
  } catch {
    throw new Error(
      'This is not a valid BolRelay workspace backup. Your current workspace has not changed.',
    );
  }
}

/** Explicit replacement only: validate the complete backup before touching saved data. */
export function restoreWorkspaceBackup(raw: string): WorkspaceSnapshot {
  const restored = parseWorkspaceBackup(raw, { origin: 'import' });
  // A restore is an explicit replacement; it always advances past every counter
  // seen so far so other open tabs become stale. The backup's own counter is ignored.
  let previous = knownWriteCount;
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) previous = Math.max(previous, storedWriteCount(current));
  } catch {
    // Unreadable original data is being explicitly replaced.
  }
  const stamp = { count: previous + 1, token: newToken() };
  const handoversJson = JSON.stringify(restored.handovers);
  const serialized = serializeWorkspace(handoversJson, restored.activeId, stamp);
  if (serialized.length > MAX_WORKSPACE_CHARACTERS)
    throw new Error(
      'This restored workspace is too large to save. Your current workspace has not changed.',
    );
  localStorage.setItem(STORAGE_KEY, serialized);
  remember(serialized, handoversJson, stamp);
  return restored;
}

function newToken(): string {
  return crypto.randomUUID();
}

function serializeWorkspace(
  handoversJson: string,
  activeId: string | null,
  stamp: WriteStamp,
): string {
  return `{"version":1,"handovers":${handoversJson},"activeId":${JSON.stringify(activeId)},"writeCount":${stamp.count}${
    stamp.token === undefined ? '' : `,"writeToken":${JSON.stringify(stamp.token)}`
  }}`;
}

/** Saved data is readable when its shape and cross-record integrity are valid. */
function readable(raw: string): boolean {
  try {
    parseWorkspaceBackup(raw, { revalidate: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates in-memory handovers for saving. A state that came out of
 * `restoreHandover` (load, import, in-app commit) or an earlier save is reused
 * by reference; any other object is fully restored once.
 */
function validatedForSave(handovers: HandoverState[]): HandoverState[] {
  return handovers.map((handover) => {
    if (isRestoredHandover(handover)) return handover;
    const known = validatedHandovers.get(handover);
    if (known) return known;
    const valid = restoreHandover(handover);
    validatedHandovers.set(handover, valid);
    return valid;
  });
}

const UNREADABLE_WARNING =
  'Saved data could not be read. The original data is still in this browser. Export or clear it before saving a new workspace.';

/** Loads saved data and records its write counter as this tab's baseline. */
export function readWorkspace(): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    seenRaw = raw;
    if (!raw) return { handovers: [], activeId: null, warning: null };
    const snapshot = parseWorkspaceBackup(raw);
    const data = JSON.parse(raw) as {
      handovers: unknown;
      writeCount?: unknown;
      writeToken?: unknown;
    };
    remember(raw, JSON.stringify(data.handovers), stampOf(data));
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
      // Text this tab already read or wrote was validated then; anything else is
      // checked for shape and integrity only (no reinterpretation) before use.
      if (raw !== knownRaw && !readable(raw)) {
        seenRaw = raw;
        return { ok: false, error: UNREADABLE_WARNING };
      }
      if (isNewer(raw)) return { ok: false, conflict: true, error: STALE_WORKSPACE_MESSAGE };
      savedHandovers =
        raw === knownRaw && knownHandoversJson !== null
          ? knownHandoversJson
          : JSON.stringify((JSON.parse(raw) as { handovers: unknown }).handovers);
    }
    const { content, handoversJson } = prepare(handovers, activeId);
    // Only a change to handover content advances the counter. Selecting another
    // handover or reopening a tab must not make other tabs stale.
    const stamp =
      savedHandovers === handoversJson
        ? { count: knownWriteCount, token: knownWriteToken }
        : { count: knownWriteCount + 1, token: newToken() };
    const serialized = serializeWorkspace(handoversJson, content.activeId, stamp);
    if (serialized.length > MAX_WORKSPACE_CHARACTERS)
      return {
        ok: false,
        error: 'This workspace is full. Export and remove older handovers to keep saving.',
      };
    if (serialized !== raw) localStorage.setItem(STORAGE_KEY, serialized);
    remember(serialized, handoversJson, stamp);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'Changes are currently only in memory. Browser storage is unavailable or full; export this handover before closing.',
    };
  }
}

function prepare(handovers: HandoverState[], activeId: string | null) {
  if (handovers.length > 40 || (activeId !== null && typeof activeId !== 'string'))
    throw new Error('Unsupported workspace.');
  if (new Set(handovers.map((h) => h.id)).size !== handovers.length)
    throw new Error('Duplicate handover identifiers.');
  const content = { handovers: validatedForSave(handovers), activeId };
  return { content, handoversJson: JSON.stringify(content.handovers) };
}

/**
 * User-initiated recovery: replaces unreadable saved data with the handovers on
 * screen. Never called automatically on parse failure. Refuses with
 * `newer: true`, leaving saved data untouched, when the saved data is readable
 * now or differs from what this tab last saw (another tab repaired or replaced
 * it); reload instead. The new counter advances past every counter seen so far.
 */
export function resetSavedWorkspace(
  handovers: HandoverState[],
  activeId: string | null,
): { ok: boolean; newer?: boolean; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null && (raw !== seenRaw || readable(raw))) return { ok: false, newer: true };
    let previous = knownWriteCount;
    try {
      if (raw !== null) previous = Math.max(previous, storedWriteCount(raw));
    } catch {
      // Unreadable data is being explicitly replaced.
    }
    const { content, handoversJson } = prepare(handovers, activeId);
    const stamp = { count: previous + 1, token: newToken() };
    const serialized = serializeWorkspace(handoversJson, content.activeId, stamp);
    if (serialized.length > MAX_WORKSPACE_CHARACTERS)
      return {
        ok: false,
        error: 'This workspace is full. Export and remove older handovers to keep saving.',
      };
    localStorage.setItem(STORAGE_KEY, serialized);
    remember(serialized, handoversJson, stamp);
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
