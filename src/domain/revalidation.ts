import { mergeShortAnswer } from './engine';
import { canonicalCondition, canonicalUnit, normalizeText, parseTranscript } from './parser';
import { misattributesLocalStatement, modelClaimConflict } from './modelGuard';
import { INTERPRETATION_RULES_VERSION, suppressesCriticalIssue } from './rulesVersion';
import type {
  HandoverEvent,
  HandoverItem,
  HandoverState,
  ParseIssue,
  ParsedClaim,
  ParsedTranscript,
  SourceReview,
  Utterance,
} from './types';

export interface RevalidationOptions {
  /** Where the state came from. Imported model read-backs are never trusted. */
  origin?: 'local' | 'import';
  /**
   * The already-revalidated state an in-app change started from. Read-backs and
   * plan evidence that are identical there are not rechecked again.
   */
  previous?: HandoverState;
}

/**
 * Revalidates saved interpretations against the CURRENT interpretation rules.
 * Called by `restoreHandover`, i.e. on every localStorage load, handover JSON
 * import and workspace backup restore. An in-app commit passes the state it
 * started from as `previous`, so only read-backs and plan evidence that the
 * commit changed are rechecked; everything else was already checked under the
 * same rules when it entered memory.
 *
 * Policy
 * - Local-rules interpretations are always re-derived from the stored original
 *   words with the parse-time item context (reconstructed from item revision
 *   snapshots), regardless of the stored `rulesVersion` stamp. An imported stamp
 *   therefore cannot vouch for claims that its own text no longer produces.
 * - Incoming read-backs: if the re-derived claims/issues for a current item
 *   differ in any compared field (or gain an issue), that item's active
 *   read-back and confirmation are reopened. Unchanged items keep their valid
 *   confirmations. Stale read-backs (older revision) cannot confirm anything and
 *   are left as they are.
 * - Outgoing instructions: the plan is never rewritten. If the source wording an
 *   item's evidence quotes now reads differently, the item is reopened for a
 *   fresh read-back and listed in `sourceReview` for the outgoing participant.
 *   One marker per (item, revision, source) keeps this from repeating after the
 *   plan was reviewed.
 * - Model interpretations cannot be re-run offline. The local critical guards
 *   (the same ones the server applies) run on the stored words on every load; a
 *   critical issue a stored claim does not mark as uncertain reopens the item.
 *   An incoming model read-back stamped with an older (or no) rules version is
 *   also reopened, because it was validated by older guards and cannot be
 *   re-verified. An outgoing model instruction without a new critical issue is
 *   kept: its structured result was reviewed by the outgoing participant before
 *   it changed the plan. A forged current stamp on a model record can only skip
 *   the outdated-version reopen, never the critical guard check.
 * - Model records also get the offline guards the server applies to model
 *   output (`server/model.ts` validateModelOutput, sharing `modelGuard.ts`): a
 *   claim whose item, action, quantity, unit, time, prerequisite or owner
 *   differs from what the current local rules read in its own quote, and that
 *   is not marked uncertain, is treated like a suppressed critical issue. A
 *   stamp newer than this build's rules (`rulesVersion >
 *   INTERPRETATION_RULES_VERSION`) is never trusted.
 * - A stamp only means something for records this browser produced itself.
 *   With `origin: 'import'` (handover JSON import, workspace backup preview
 *   and restore) every active model read-back is reopened as unverifiable,
 *   because an imported file can relabel and restamp any record. Saved data in
 *   this browser's own storage (`origin: 'local'`, the default) keeps a model
 *   read-back that passes the checks above.
 * - A short answer completed from a model read-back cannot be re-derived
 *   offline (the model cannot be re-run), so it is treated as unverifiable.
 *   `completeShortAnswer` never creates such a merge, so this cannot loop.
 * - When the parse-time context cannot be reconstructed or re-parsing fails,
 *   the interpretation is treated as unverifiable and reopened/flagged.
 * - Idempotent: reopening removes the active result it judged, so a second load
 *   finds nothing to change and adds no events. Original utterances and history
 *   are preserved; no participant acknowledgement is added.
 */
export function revalidateInterpretations(
  state: HandoverState,
  options: RevalidationOptions = {},
): HandoverState {
  const previous = options.previous;
  const snapshots = new Map<string, HandoverItem>();
  const key = (id: string, revision: number) => `${id}\u0000${revision}`;
  for (const event of state.events)
    for (const item of [...(event.before ?? []), ...(event.after ?? [])])
      snapshots.set(key(item.id, item.revision), item);
  for (const item of state.items) snapshots.set(key(item.id, item.revision), item);

  /** The parse-time input of a stored utterance; throws when it cannot be rebuilt. */
  const parseInput = (utterance: Utterance) => {
    const items: HandoverItem[] = [];
    for (const [id, revision] of Object.entries(utterance.itemRevisions)) {
      const snapshot = snapshots.get(key(id, revision));
      if (!snapshot) throw new Error('Parse-time item context is unavailable.');
      items.push(snapshot);
    }
    return {
      text: utterance.text,
      role: utterance.role,
      language: utterance.language,
      items,
      utteranceId: utterance.utteranceId,
      ...(utterance.role === 'incoming' && utterance.scopeItemIds
        ? { scopeItemIds: [...utterance.scopeItemIds] }
        : {}),
      ...(utterance.answerField ? { answerField: utterance.answerField } : {}),
    };
  };
  const reparsed = new Map<string, ParsedTranscript | null>();
  const reparse = (utterance: Utterance): ParsedTranscript | null => {
    if (reparsed.has(utterance.utteranceId)) return reparsed.get(utterance.utteranceId)!;
    let result: ParsedTranscript | null = null;
    try {
      result = parseTranscript(parseInput(utterance));
      // A short answer ("8", "after 3 PM") was completed from the worker's own
      // earlier statement. Re-derive that statement under the current rules too,
      // then apply the same merge, so an unchanged chain compares equal.
      const reference = utterance.claims.find((claim) => claim.basis)?.basis;
      if (reference) {
        reparsed.set(utterance.utteranceId, null); // cycle guard
        const basisUtterance = source(reference.utteranceId);
        // A model basis cannot be re-run offline; merging local rules over it
        // would compare a different reading and reopen it on every check.
        const basis = basisUtterance?.parser === 'local-rules' ? reparse(basisUtterance) : null;
        const itemId = utterance.scopeItemIds?.[0];
        if (!basis || !itemId || utterance.scopeItemIds?.length !== 1)
          throw new Error('Short-answer basis is unavailable.');
        result =
          mergeShortAnswer(
            result,
            itemId,
            basis.utteranceId,
            basis.claims.filter((claim) => claim.itemIds.includes(itemId)),
            basis.issues.filter(
              (issue) => issue.itemIds.length === 0 || issue.itemIds.includes(itemId),
            ),
          ) ?? null;
      }
    } catch {
      result = null;
    }
    reparsed.set(utterance.utteranceId, result);
    return result;
  };
  const source = (id: string) => state.utterances.find((u) => u.utteranceId === id);

  /**
   * Offline replay of the guards `server/model.ts` applies to model output, for
   * one item of a stored model utterance (`fresh` is its current local parse):
   * each claim is bounded by the local reading of its own quote (shared
   * `modelClaimConflict`), may not suppress a current critical issue of the
   * quote or the whole source, and no local statement about the item may be
   * parked under another item. Field evidence is not stored, so the
   * evidence-span checks cannot be replayed; anything unverifiable is suspect.
   */
  const quoteParses = new Map<string, ParsedTranscript>();
  const modelReadingSuspect = (utterance: Utterance, itemId: string, fresh: ParsedTranscript) => {
    try {
      if (
        misattributesLocalStatement(
          utterance.text,
          fresh.claims,
          utterance.claims,
          utterance.issues,
          (id) => id === itemId,
        )
      )
        return true;
      const input = parseInput(utterance);
      return forItem(utterance, itemId)[0].some((claim) => {
        const quote = `${utterance.utteranceId}\u0000${claim.evidence.text}`;
        if (!quoteParses.has(quote))
          quoteParses.set(quote, parseTranscript({ ...input, text: claim.evidence.text }));
        const local = quoteParses.get(quote)!;
        return (
          suppressesCriticalIssue(claim, [...local.issues, ...fresh.issues]) ||
          modelClaimConflict(
            claim,
            local.claims.filter((candidate) =>
              candidate.itemIds.some((id) => claim.itemIds.includes(id)),
            ),
          ) !== undefined
        );
      });
    } catch {
      return true;
    }
  };

  // Incoming read-backs.
  const reopened = new Map<string, 'changed' | 'unverifiable' | 'critical' | 'outdated-model'>();
  for (const [id, readback] of Object.entries(state.readbacks)) {
    const item = state.items.find((candidate) => candidate.id === id);
    const utterance = source(readback.utteranceId);
    if (!item || !utterance || readback.itemRevision !== item.revision) continue;
    const before = previous?.readbacks[id];
    if (
      before &&
      before.utteranceId === readback.utteranceId &&
      before.itemRevision === readback.itemRevision
    )
      continue; // Unchanged by this in-app change and already checked.
    if (utterance.parser !== 'local-rules' && options.origin === 'import') {
      reopened.set(id, 'unverifiable');
      continue;
    }
    const fresh = reparse(utterance);
    if (!fresh) reopened.set(id, 'unverifiable');
    else if (utterance.parser === 'local-rules') {
      if (
        interpretationSignature(readback.claims, readback.issues) !==
        interpretationSignature(...forItem(fresh, id))
      )
        reopened.set(id, 'changed');
    } else if (modelReadingSuspect(utterance, id, fresh)) reopened.set(id, 'critical');
    else if ((utterance.rulesVersion ?? 0) !== INTERPRETATION_RULES_VERSION)
      // Older guards, or a stamp from rules this build does not know.
      reopened.set(id, 'outdated-model');
  }

  // Outgoing instruction sources currently quoted by the plan.
  const at = new Date().toISOString();
  const existingReviews = (state.sourceReview ?? []).filter((review) =>
    state.items.some((item) => item.id === review.itemId && item.revision === review.itemRevision),
  );
  const newReviews: SourceReview[] = [];
  // Items whose plan contradicts the very claim its source excerpt records.
  const planMismatch = new Set<string>();
  for (const item of state.items) {
    const sources = new Set(item.evidence.map((evidence) => evidence.utteranceId));
    const earlier = previous?.items.find((candidate) => candidate.id === item.id);
    if (
      earlier &&
      earlier.revision === item.revision &&
      earlier.evidence.every((evidence) => sources.has(evidence.utteranceId)) &&
      item.evidence.every((evidence) =>
        earlier.evidence.some((other) => other.utteranceId === evidence.utteranceId),
      )
    )
      continue; // Same revision quoting the same sources: already checked.
    for (const utteranceId of sources) {
      const marked = (review: SourceReview) =>
        review.itemId === item.id &&
        review.itemRevision === item.revision &&
        review.utteranceId === utteranceId;
      if (existingReviews.some(marked) || newReviews.some(marked)) continue;
      const utterance = source(utteranceId);
      if (!utterance || utterance.role !== 'outgoing') continue;
      const fresh = reparse(utterance);
      const contradicts = quoteContradictsPlan(utterance, item);
      if (contradicts) planMismatch.add(item.id);
      const differs = !fresh
        ? true
        : utterance.parser === 'local-rules'
          ? interpretationSignature(...forItem(utterance, item.id)) !==
            interpretationSignature(...forItem(fresh, item.id))
          : (utterance.rulesVersion ?? 0) > INTERPRETATION_RULES_VERSION ||
            modelReadingSuspect(utterance, item.id, fresh);
      if (differs || contradicts)
        newReviews.push({
          itemId: item.id,
          itemRevision: item.revision,
          utteranceId,
          reviewed: false,
          createdAt: at,
        });
    }
  }

  const pruned = existingReviews.length !== (state.sourceReview ?? []).length;
  if (reopened.size === 0 && newReviews.length === 0 && !pruned) return state;

  const next: HandoverState = {
    ...state,
    readbacks: { ...state.readbacks },
    confirmations: { ...state.confirmations },
    events: [...state.events],
  };
  const sourceReview = boundedSourceReview(existingReviews, newReviews);
  if (sourceReview.length) next.sourceReview = sourceReview;
  else delete next.sourceReview;
  const flaggedIds = [...new Set(newReviews.map((review) => review.itemId))];
  const flagged = flaggedIds.filter((id) => !planMismatch.has(id));
  const mismatched = flaggedIds.filter((id) => planMismatch.has(id));
  const affected = [...new Set([...reopened.keys(), ...flaggedIds])];
  if (affected.length === 0) return next;

  for (const id of affected) {
    delete next.readbacks[id];
    delete next.confirmations[id];
  }
  next.recheckNotice = {
    reason: state.recheckNotice?.reason ?? 'interpretation-rules-changed',
    itemIds: [...new Set([...(state.recheckNotice?.itemIds ?? []), ...affected])],
    createdAt: state.recheckNotice?.createdAt ?? at,
  };
  next.updatedAt = Date.parse(state.updatedAt) > Date.parse(at) ? state.updatedAt : at;
  const label = (id: string) => state.items.find((item) => item.id === id)?.label ?? id;
  const append = (event: Omit<HandoverEvent, 'id' | 'createdAt'>) => {
    // At the history limit the persisted notice still explains the recheck.
    if (next.events.length < 5_000)
      next.events.push({ ...event, id: `event-${crypto.randomUUID()}`, createdAt: at });
  };
  if (reopened.size)
    append({
      type: 'interpretation-upgraded',
      itemIds: [...reopened.keys()],
      message: clip(
        `System update: interpretation rules changed (version ${INTERPRETATION_RULES_VERSION}). The saved read-back for ${describeItems(
          [...reopened.keys()],
          label,
        )} now reads differently or could not be re-verified, so it needs a fresh read-back. Original statements and history were retained; no participant acknowledgement was added.`,
        MAX_EVENT_MESSAGE,
      ),
    });
  if (flagged.length)
    append({
      type: 'interpretation-upgraded',
      itemIds: flagged,
      message: clip(
        `System update: interpretation rules changed (version ${INTERPRETATION_RULES_VERSION}). The original instruction words for ${describeItems(
          flagged,
          label,
        )} now read differently from the saved plan. The plan was not changed; the outgoing participant should review it, and a fresh read-back is required.`,
        MAX_EVENT_MESSAGE,
      ),
    });
  if (mismatched.length)
    append({
      type: 'interpretation-upgraded',
      itemIds: mismatched,
      message: clip(
        `System check: the saved plan for ${describeItems(
          mismatched,
          label,
        )} does not match the instruction words it quotes. The plan was not changed; the outgoing participant should review it, and a fresh read-back is required.`,
        MAX_EVENT_MESSAGE,
      ),
    });
  return next;
}

/**
 * True when a claim recorded for one of the item's quoted excerpts states a
 * value that differs from the item's plan. Every field the quote states is
 * compared, whether or not the item lists it in `evidenceFields`, so a plan
 * edited outside the app cannot keep showing a quote that says otherwise.
 * Fields the quote leaves out or marks uncertain are not compared (a spoken
 * change keeps unmentioned fields), nor is a group total against one member.
 */
function quoteContradictsPlan(utterance: Utterance, item: HandoverItem): boolean {
  const quoted = utterance.claims.filter(
    (claim) =>
      claim.itemIds.includes(item.id) &&
      item.evidence.some(
        (evidence) =>
          evidence.utteranceId === utterance.utteranceId &&
          evidence.start === claim.evidence.start &&
          evidence.end === claim.evidence.end &&
          evidence.text === claim.evidence.text,
      ),
  );
  return quoted.some((claim) => {
    const stated = (field: ParsedClaim['uncertainFields'][number]) =>
      !claim.uncertainFields.includes(field);
    return (
      (claim.action !== undefined && stated('action') && claim.action !== item.action) ||
      (claim.quantity !== undefined &&
        claim.itemIds.length === 1 &&
        stated('quantity') &&
        claim.quantity !== item.quantity) ||
      (claim.unit !== undefined &&
        stated('unit') &&
        canonicalUnit(claim.unit) !== canonicalUnit(item.unit)) ||
      (claim.notBefore !== undefined &&
        stated('notBefore') &&
        (claim.notBefore ?? null) !== item.notBefore) ||
      (claim.condition !== undefined &&
        stated('condition') &&
        canonicalCondition(claim.condition ?? '') !== canonicalCondition(item.condition ?? '')) ||
      (claim.owner !== undefined &&
        stated('owner') &&
        normalizeText(claim.owner ?? '') !== normalizeText(item.owner ?? ''))
    );
  });
}

/** Schema limits that revalidation output must stay within (see `schema.ts`). */
const MAX_EVENT_MESSAGE = 1_000;
const MAX_SOURCE_REVIEWS = 500;

/** Cuts text to at most `max` UTF-16 units without splitting a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** A few item names; the event's `itemIds` carry the complete list. */
function describeItems(ids: string[], label: (id: string) => string): string {
  const shown = ids.slice(0, 3).map((id) => clip(label(id), 60));
  const more = ids.length - shown.length;
  return more > 0 ? `${ids.length} items (${shown.join(', ')} and ${more} more)` : shown.join(', ');
}

/**
 * Keeps the review list within the schema limit. Every newly flagged item keeps
 * at least one marker so it stays visibly pending; extra markers past the
 * limit are dropped. A dropped marker only means that source may be flagged
 * (and its item reopened) again on a later load, which fails closed.
 */
function boundedSourceReview(existing: SourceReview[], added: SourceReview[]): SourceReview[] {
  if (existing.length + added.length <= MAX_SOURCE_REVIEWS) return [...existing, ...added];
  const firstPerItem = added.filter(
    (review, index) => added.findIndex((other) => other.itemId === review.itemId) === index,
  );
  const rest = added.filter((review) => !firstPerItem.includes(review));
  return [...firstPerItem, ...existing, ...rest].slice(0, MAX_SOURCE_REVIEWS);
}

/** The outgoing participant reviewed every flagged instruction and kept or edited it. */
export function acknowledgeSourceReview(state: HandoverState, actor = state.outgoingName) {
  const pending = (state.sourceReview ?? []).filter((review) => !review.reviewed);
  if (pending.length === 0) return state;
  const at = new Date().toISOString();
  const itemIds = [...new Set(pending.map((review) => review.itemId))];
  return {
    ...state,
    sourceReview: (state.sourceReview ?? []).map((review) => ({ ...review, reviewed: true })),
    updatedAt: Date.parse(state.updatedAt) > Date.parse(at) ? state.updatedAt : at,
    events:
      state.events.length < 5_000
        ? [
            ...state.events,
            {
              id: `event-${crypto.randomUUID()}`,
              type: 'interpretation-upgraded' as const,
              itemIds,
              message: `${actor.trim().slice(0, 100) || 'Outgoing participant'} reviewed the flagged instruction wording and kept the current plan.`,
              createdAt: at,
            },
          ]
        : state.events,
  };
}

export function pendingSourceReviewItemIds(state: HandoverState): string[] {
  return [
    ...new Set(
      (state.sourceReview ?? [])
        .filter(
          (review) =>
            !review.reviewed &&
            state.items.some(
              (item) => item.id === review.itemId && item.revision === review.itemRevision,
            ),
        )
        .map((review) => review.itemId),
    ),
  ];
}

function forItem(parsed: Pick<ParsedTranscript, 'claims' | 'issues'>, id: string) {
  return [
    parsed.claims.filter((claim) => claim.itemIds.includes(id)),
    parsed.issues.filter((issue) => issue.itemIds.length === 0 || issue.itemIds.includes(id)),
  ] as const;
}

/** Compared meaning only: quotes/offsets and wording of messages may change harmlessly. */
export function interpretationSignature(claims: ParsedClaim[], issues: ParseIssue[]): string {
  const claimKeys = claims.map((claim) =>
    JSON.stringify([
      [...claim.itemIds].sort(),
      claim.action ?? null,
      claim.quantity ?? null,
      claim.unit == null ? null : canonicalUnit(claim.unit),
      claim.notBefore ?? null,
      claim.condition == null ? null : canonicalCondition(claim.condition),
      claim.owner == null ? null : normalizeText(claim.owner),
      [...new Set(claim.uncertainFields)].sort(),
    ]),
  );
  const issueKeys = issues.map((issue) =>
    JSON.stringify([issue.code, issue.field, [...issue.itemIds].sort()]),
  );
  return JSON.stringify([claimKeys.sort(), issueKeys.sort()]);
}
