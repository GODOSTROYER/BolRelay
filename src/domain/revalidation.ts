import { mergeShortAnswer } from './engine';
import { canonicalCondition, canonicalUnit, normalizeText, parseTranscript } from './parser';
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

/**
 * Revalidates saved interpretations against the CURRENT interpretation rules.
 * Called by `restoreHandover`, i.e. on every localStorage load, handover JSON
 * import, workspace backup restore, and in-app commit.
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
 * - When the parse-time context cannot be reconstructed or re-parsing fails,
 *   the interpretation is treated as unverifiable and reopened/flagged.
 * - Idempotent: reopening removes the active result it judged, so a second load
 *   finds nothing to change and adds no events. Original utterances and history
 *   are preserved; no participant acknowledgement is added.
 */
export function revalidateInterpretations(state: HandoverState): HandoverState {
  const snapshots = new Map<string, HandoverItem>();
  const key = (id: string, revision: number) => `${id}\u0000${revision}`;
  for (const event of state.events)
    for (const item of [...(event.before ?? []), ...(event.after ?? [])])
      snapshots.set(key(item.id, item.revision), item);
  for (const item of state.items) snapshots.set(key(item.id, item.revision), item);

  const reparsed = new Map<string, ParsedTranscript | null>();
  const reparse = (utterance: Utterance): ParsedTranscript | null => {
    if (reparsed.has(utterance.utteranceId)) return reparsed.get(utterance.utteranceId)!;
    let result: ParsedTranscript | null = null;
    try {
      const items: HandoverItem[] = [];
      for (const [id, revision] of Object.entries(utterance.itemRevisions)) {
        const snapshot = snapshots.get(key(id, revision));
        if (!snapshot) throw new Error('Parse-time item context is unavailable.');
        items.push(snapshot);
      }
      result = parseTranscript({
        text: utterance.text,
        role: utterance.role,
        language: utterance.language,
        items,
        utteranceId: utterance.utteranceId,
        ...(utterance.role === 'incoming' && utterance.scopeItemIds
          ? { scopeItemIds: [...utterance.scopeItemIds] }
          : {}),
        ...(utterance.answerField ? { answerField: utterance.answerField } : {}),
      });
      // A short answer ("8", "after 3 PM") was completed from the worker's own
      // earlier statement. Re-derive that statement under the current rules too,
      // then apply the same merge, so an unchanged chain compares equal.
      const reference = utterance.claims.find((claim) => claim.basis)?.basis;
      if (reference) {
        reparsed.set(utterance.utteranceId, null); // cycle guard
        const basisUtterance = source(reference.utteranceId);
        const basis = basisUtterance ? reparse(basisUtterance) : null;
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

  // Incoming read-backs.
  const reopened = new Map<string, 'changed' | 'unverifiable' | 'critical' | 'outdated-model'>();
  for (const [id, readback] of Object.entries(state.readbacks)) {
    const item = state.items.find((candidate) => candidate.id === id);
    const utterance = source(readback.utteranceId);
    if (!item || !utterance || readback.itemRevision !== item.revision) continue;
    const fresh = reparse(utterance);
    if (!fresh) reopened.set(id, 'unverifiable');
    else if (utterance.parser === 'local-rules') {
      if (
        interpretationSignature(readback.claims, readback.issues) !==
        interpretationSignature(...forItem(fresh, id))
      )
        reopened.set(id, 'changed');
    } else if (readback.claims.some((claim) => suppressesCriticalIssue(claim, fresh.issues)))
      reopened.set(id, 'critical');
    else if ((utterance.rulesVersion ?? 0) < INTERPRETATION_RULES_VERSION)
      reopened.set(id, 'outdated-model');
  }

  // Outgoing instruction sources currently quoted by the plan.
  const at = new Date().toISOString();
  const existingReviews = (state.sourceReview ?? []).filter((review) =>
    state.items.some((item) => item.id === review.itemId && item.revision === review.itemRevision),
  );
  const newReviews: SourceReview[] = [];
  for (const item of state.items)
    for (const utteranceId of new Set(item.evidence.map((evidence) => evidence.utteranceId))) {
      const marked = (review: SourceReview) =>
        review.itemId === item.id &&
        review.itemRevision === item.revision &&
        review.utteranceId === utteranceId;
      if (existingReviews.some(marked) || newReviews.some(marked)) continue;
      const utterance = source(utteranceId);
      if (!utterance || utterance.role !== 'outgoing') continue;
      const fresh = reparse(utterance);
      const differs = !fresh
        ? true
        : utterance.parser === 'local-rules'
          ? interpretationSignature(...forItem(utterance, item.id)) !==
            interpretationSignature(...forItem(fresh, item.id))
          : forItem(utterance, item.id)[0].some((claim) =>
              suppressesCriticalIssue(claim, fresh.issues),
            );
      if (differs)
        newReviews.push({
          itemId: item.id,
          itemRevision: item.revision,
          utteranceId,
          reviewed: false,
          createdAt: at,
        });
    }

  const pruned = existingReviews.length !== (state.sourceReview ?? []).length;
  if (reopened.size === 0 && newReviews.length === 0 && !pruned) return state;

  const next: HandoverState = {
    ...state,
    readbacks: { ...state.readbacks },
    confirmations: { ...state.confirmations },
    events: [...state.events],
  };
  const sourceReview = [...existingReviews, ...newReviews];
  if (sourceReview.length) next.sourceReview = sourceReview;
  else delete next.sourceReview;
  const flagged = [...new Set(newReviews.map((review) => review.itemId))];
  const affected = [...new Set([...reopened.keys(), ...flagged])];
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
      message: `System update: interpretation rules changed (version ${INTERPRETATION_RULES_VERSION}). The saved read-back for ${[
        ...reopened.keys(),
      ]
        .map(label)
        .join(
          ', ',
        )} now reads differently or could not be re-verified, so it needs a fresh read-back. Original statements and history were retained; no participant acknowledgement was added.`,
    });
  if (flagged.length)
    append({
      type: 'interpretation-upgraded',
      itemIds: flagged,
      message: `System update: interpretation rules changed (version ${INTERPRETATION_RULES_VERSION}). The original instruction words for ${flagged
        .map(label)
        .join(
          ', ',
        )} now read differently from the saved plan. The plan was not changed; the outgoing participant should review it, and a fresh read-back is required.`,
    });
  return next;
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
