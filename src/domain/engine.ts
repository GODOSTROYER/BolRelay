import {
  canonicalCondition,
  canonicalUnit,
  hasUntilGate,
  normalizeText,
  parseTranscript,
  statesProhibition,
} from './parser';
import { revalidateInterpretations, type RevalidationOptions } from './revalidation';
import { stampInterpretation } from './rulesVersion';
import {
  handoverItemSchema,
  handoverStateSchema,
  languageSchema,
  parsedTranscriptSchema,
} from './schema';
import type {
  ClaimField,
  ComparisonStatus,
  CreateHandoverInput,
  Evidence,
  Finding,
  HandoverEvent,
  HandoverItem,
  HandoverState,
  ItemComparison,
  ItemInput,
  ItemPatch,
  Language,
  ParseIssue,
  ParsedClaim,
  ParsedTranscript,
  ParticipantRole,
  SubmitReadbackOptions,
} from './types';

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const latest = (a: string, b: string) => (new Date(a).getTime() > new Date(b).getTime() ? a : b);
const clockLabel = (value: string | null | undefined) => value ?? 'not stated';

function validTimestamp(at: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at)))
    throw new DomainError('INVALID_TIMESTAMP', 'Use a valid ISO timestamp.');
  return new Date(at).toISOString();
}

function appendEvent(state: HandoverState, event: Omit<HandoverEvent, 'id'>): HandoverState {
  return {
    ...state,
    updatedAt: latest(state.updatedAt, event.createdAt),
    events: [...state.events, { ...event, id: uid('event') }],
  };
}

function remainingRecheckNotice(state: HandoverState, clearedIds: Set<string>) {
  if (!state.recheckNotice) return undefined;
  const itemIds = state.recheckNotice.itemIds.filter((id) => !clearedIds.has(id));
  return itemIds.length ? { ...state.recheckNotice, itemIds } : undefined;
}

function validatedItem(input: ItemInput, revision = 1): HandoverItem {
  const result = handoverItemSchema.safeParse({
    ...input,
    aliases: input.aliases ?? [],
    evidence: input.evidence ?? [],
    condition: input.condition?.trim() || null,
    owner: input.owner?.trim() || null,
    revision,
  });
  if (!result.success)
    throw new DomainError(
      'INVALID_ITEM',
      result.error.issues.map((issue) => issue.message).join('; '),
    );
  return result.data;
}

export function createHandover(input: CreateHandoverInput = {}): HandoverState {
  const at = validTimestamp(input.at ?? now());
  const items = (input.items ?? []).map((item) => validatedItem(item));
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new DomainError('DUPLICATE_ITEM', 'Each board item needs a unique ID.');
  const state: HandoverState = {
    schemaVersion: 1,
    id: input.id ?? uid('handover'),
    title: input.title?.trim() || 'New handover',
    outgoingName: input.outgoingName?.trim() || 'Outgoing worker',
    incomingName: input.incomingName?.trim() || 'Incoming worker',
    language: input.language ?? 'en-IN',
    participantLanguages: {
      outgoing: input.participantLanguages?.outgoing ?? input.language ?? 'en-IN',
      incoming: input.participantLanguages?.incoming ?? input.language ?? 'en-IN',
    },
    items,
    utterances: [],
    readbacks: {},
    confirmations: {},
    events: [],
    createdAt: at,
    updatedAt: at,
  };
  return appendEvent(handoverStateSchema.parse(state), {
    type: 'created',
    itemIds: items.map((item) => item.id),
    message: 'Handover created. Instructions need an independent read-back.',
    createdAt: at,
  });
}

/** Preferences do not change operational instructions or invalidate acknowledgements. */
export function setParticipantLanguage(
  state: HandoverState,
  role: ParticipantRole,
  language: Language,
): HandoverState {
  if ((role !== 'outgoing' && role !== 'incoming') || !languageSchema.safeParse(language).success)
    throw new DomainError('INVALID_LANGUAGE', 'Choose a supported participant language.');
  const current = state.participantLanguages ?? {
    outgoing: state.language,
    incoming: state.language,
  };
  if (current[role] === language) return state;
  return {
    ...state,
    participantLanguages: { ...current, [role]: language },
    updatedAt: latest(state.updatedAt, now()),
  };
}

function validateParsed(parsed: ParsedTranscript, items: HandoverItem[]) {
  const result = parsedTranscriptSchema.safeParse(parsed);
  if (!result.success)
    throw new DomainError(
      'INVALID_TRANSCRIPT',
      result.error.issues.map((issue) => issue.message).join('; '),
    );
  const ids = new Set(items.map((item) => item.id));
  if (
    (result.data.role === 'outgoing' &&
      (result.data.readbackMode !== undefined || result.data.scopeItemIds !== undefined)) ||
    (result.data.readbackMode === 'full' && result.data.scopeItemIds !== undefined) ||
    (result.data.readbackMode === 'targeted' && !result.data.scopeItemIds?.length) ||
    (result.data.answerField !== undefined &&
      (result.data.readbackMode !== 'targeted' || result.data.scopeItemIds?.length !== 1)) ||
    (result.data.scopeItemIds &&
      (new Set(result.data.scopeItemIds).size !== result.data.scopeItemIds.length ||
        result.data.scopeItemIds.some((id) => !ids.has(id))))
  )
    throw new DomainError(
      'INVALID_READBACK_SCOPE',
      'The recording contains an invalid read-back scope.',
    );
  const claimIds = new Set<string>();
  for (const claim of result.data.claims) {
    if (claimIds.has(claim.id))
      throw new DomainError('DUPLICATE_CLAIM', 'Claim IDs must be unique.');
    claimIds.add(claim.id);
    if (new Set(claim.itemIds).size !== claim.itemIds.length)
      throw new DomainError('DUPLICATE_REFERENCE', 'A claim cannot count the same item twice.');
    if (
      claim.basis &&
      (!result.data.answerField ||
        claim.itemIds.length !== 1 ||
        claim.itemIds[0] !== result.data.scopeItemIds?.[0] ||
        claim.basis.utteranceId === result.data.utteranceId ||
        claim.basis.fields.includes('object') ||
        new Set(claim.basis.fields).size !== claim.basis.fields.length)
    )
      throw new DomainError(
        'INVALID_ANSWER_BASIS',
        'A short answer can only complete an earlier read-back of the selected item.',
      );
  }
  for (const part of [...result.data.claims, ...result.data.issues]) {
    if (part.itemIds.some((id) => !ids.has(id)))
      throw new DomainError(
        'UNKNOWN_ITEM',
        'The transcript references an item outside this handover.',
      );
    const e = part.evidence;
    if (
      e.utteranceId !== parsed.utteranceId ||
      e.end > parsed.text.length ||
      e.text !== parsed.text.slice(e.start, e.end)
    )
      throw new DomainError(
        'UNGROUNDED_EVIDENCE',
        'Every finding must quote the original transcript at its actual offsets.',
      );
  }
  return result.data;
}

function finding(
  item: HandoverItem,
  field: Finding['field'],
  status: Finding['status'],
  message: string,
  expected: string,
  heard: string,
  evidence: Evidence[],
): Finding {
  return {
    id: `${item.id}-${field}-${status}-${evidence[0]?.start ?? 0}`,
    field,
    status,
    message,
    expected,
    heard,
    evidence,
  };
}

function basisEvidence(state: HandoverState, claim: ParsedClaim): Evidence[] {
  const chain: Evidence[] = [];
  const seen = new Set<string>();
  let current = claim;
  while (current.basis && !seen.has(current.basis.utteranceId)) {
    seen.add(current.basis.utteranceId);
    const reference = current.basis;
    const next = state.utterances
      .find((utterance) => utterance.utteranceId === reference.utteranceId)
      ?.claims.find((candidate) => candidate.id === reference.claimId);
    if (!next) break;
    chain.unshift(next.evidence);
    current = next;
  }
  return chain;
}

/** Compare only explicit facts; missing and uncertain information never become agreement. */
export function compareHandover(state: HandoverState): ItemComparison[] {
  return state.items.map((item) => {
    const readback = state.readbacks[item.id];
    const stale = !!readback && readback.itemRevision !== item.revision;
    // A short answer is shown together with the earlier statements it completes.
    const evidence =
      readback?.claims.flatMap((claim) => [...basisEvidence(state, claim), claim.evidence]) ?? [];
    const findings: Finding[] = [];
    if (!readback || stale) {
      findings.push(
        finding(
          item,
          'object',
          'omission',
          stale
            ? 'The instruction changed after this read-back. Explain the current plan again.'
            : 'This item has not been covered in the read-back.',
          `Current instruction r${item.revision}`,
          stale ? `Read-back for r${readback!.itemRevision}` : 'No read-back',
          evidence,
        ),
      );
    } else {
      for (const issue of readback.issues)
        findings.push(
          finding(
            item,
            issue.field,
            'uncertainty',
            issue.message,
            'A clear, explicit statement',
            issue.evidence.text,
            [issue.evidence],
          ),
        );
      if (readback.claims.length === 0 && findings.length === 0)
        findings.push(
          finding(
            item,
            'object',
            'omission',
            'State the next action for this item.',
            item.label,
            'Not stated',
            [],
          ),
        );
      for (const claim of readback.claims) {
        const ev = [claim.evidence];
        const uncertain = new Set(claim.uncertainFields);
        for (const field of uncertain)
          if (!findings.some((f) => f.field === field && f.status === 'uncertainty'))
            findings.push(
              finding(
                item,
                field,
                'uncertainty',
                `The ${field === 'notBefore' ? 'release time' : field} could not be established.`,
                'Explicit current instruction',
                'Uncertain',
                ev,
              ),
            );

        if (!uncertain.has('action')) {
          if (!claim.action)
            findings.push(
              finding(
                item,
                'action',
                'omission',
                'Say what you intend to do with this item.',
                item.action,
                'Not stated',
                ev,
              ),
            );
          else if (claim.action !== item.action)
            findings.push(
              finding(
                item,
                'action',
                'contradiction',
                item.action === 'hold'
                  ? 'The current instruction keeps this item on hold; the read-back proposes a different action.'
                  : `The read-back says ${claim.action}, while the instruction says ${item.action}.`,
                item.action,
                claim.action,
                ev,
              ),
            );
        }

        const targetItems = claim.itemIds.map((id) =>
          state.items.find((candidate) => candidate.id === id),
        );
        if (targetItems.some((target) => !target))
          findings.push(
            finding(
              item,
              'object',
              'uncertainty',
              'The referenced item group has changed. Restate it.',
              'Current board items',
              claim.itemIds.join(', '),
              ev,
            ),
          );
        const expectedQuantity = targetItems.reduce(
          (sum, target) => sum + (target?.quantity ?? 0),
          0,
        );
        if (!uncertain.has('quantity')) {
          if (claim.quantity === undefined)
            findings.push(
              finding(
                item,
                'quantity',
                'omission',
                'Include the quantity for this item or group.',
                String(expectedQuantity),
                'Not stated',
                ev,
              ),
            );
          else if (claim.quantity !== expectedQuantity)
            findings.push(
              finding(
                item,
                'quantity',
                'contradiction',
                'The quantity differs from the confirmed instruction.',
                String(expectedQuantity),
                String(claim.quantity),
                ev,
              ),
            );
        }
        if (!uncertain.has('unit')) {
          if (!claim.unit)
            findings.push(
              finding(
                item,
                'unit',
                'omission',
                'Name the unit so pieces and cartons cannot be confused.',
                item.unit,
                'Not stated',
                ev,
              ),
            );
          else if (canonicalUnit(claim.unit) !== canonicalUnit(item.unit))
            findings.push(
              finding(
                item,
                'unit',
                'contradiction',
                'The unit differs from the instruction.',
                item.unit,
                claim.unit,
                ev,
              ),
            );
        }
        if (
          new Set(targetItems.filter(Boolean).map((target) => canonicalUnit(target!.unit))).size > 1
        )
          findings.push(
            finding(
              item,
              'unit',
              'uncertainty',
              'This statement combines different units. Describe each item separately.',
              'One unit per counted group',
              claim.unit ?? 'Not stated',
              ev,
            ),
          );

        if (!uncertain.has('notBefore')) {
          if (item.notBefore && !claim.notBefore)
            findings.push(
              finding(
                item,
                'notBefore',
                'omission',
                'The earliest release time is missing.',
                `At or after ${item.notBefore}`,
                'Not stated',
                ev,
              ),
            );
          else if (item.notBefore && claim.notBefore && claim.notBefore < item.notBefore)
            findings.push(
              finding(
                item,
                'notBefore',
                'contradiction',
                'The intended time is earlier than the permitted release time.',
                `At or after ${item.notBefore}`,
                claim.notBefore,
                ev,
              ),
            );
          else if (!item.notBefore && claim.notBefore && item.action !== 'hold')
            findings.push(
              finding(
                item,
                'notBefore',
                'uncertainty',
                'The read-back adds a time that is not in the confirmed plan. Ask the outgoing worker.',
                'No time specified',
                clockLabel(claim.notBefore),
                ev,
              ),
            );
        }
        if (!uncertain.has('condition')) {
          if (item.condition && !claim.condition)
            findings.push(
              finding(
                item,
                'condition',
                'omission',
                'The release condition is missing from the read-back.',
                item.condition,
                'Not stated',
                ev,
              ),
            );
          else if (
            item.condition &&
            claim.condition &&
            canonicalCondition(item.condition) !== canonicalCondition(claim.condition)
          )
            findings.push(
              finding(
                item,
                'condition',
                'uncertainty',
                'These prerequisites differ. Ask which condition is intended.',
                item.condition,
                claim.condition,
                ev,
              ),
            );
          else if (!item.condition && claim.condition)
            findings.push(
              finding(
                item,
                'condition',
                'uncertainty',
                'The read-back adds an unconfirmed prerequisite.',
                'No prerequisite specified',
                claim.condition,
                ev,
              ),
            );
        }
        if (!uncertain.has('owner')) {
          if (item.owner && !claim.owner)
            findings.push(
              finding(
                item,
                'owner',
                'omission',
                'State who owns this action.',
                item.owner,
                'Not stated',
                ev,
              ),
            );
          else if (
            item.owner &&
            claim.owner &&
            normalizeText(item.owner) !== normalizeText(claim.owner)
          )
            findings.push(
              finding(
                item,
                'owner',
                'contradiction',
                'The assigned person differs from the plan.',
                item.owner,
                claim.owner,
                ev,
              ),
            );
          else if (!item.owner && claim.owner)
            findings.push(
              finding(
                item,
                'owner',
                'uncertainty',
                'The read-back assigns a person who is not in the confirmed plan.',
                'No owner specified',
                claim.owner,
                ev,
              ),
            );
        }
      }
    }
    const status: ComparisonStatus = findings.some((f) => f.status === 'contradiction')
      ? 'contradiction'
      : findings.some((f) => f.status === 'uncertainty')
        ? 'uncertainty'
        : findings.length
          ? 'omission'
          : 'agreement';
    const confirmation = state.confirmations[item.id];
    const confirmed =
      status === 'agreement' &&
      !!confirmation &&
      !!readback &&
      confirmation.itemRevision === item.revision &&
      confirmation.utteranceId === readback.utteranceId;
    const priority =
      findings.find((f) => f.status === 'contradiction') ??
      findings.find((f) => f.status === 'uncertainty') ??
      findings[0];
    return {
      itemId: item.id,
      itemRevision: item.revision,
      status,
      confirmed,
      stale,
      findings,
      clarification: priority
        ? `${stale ? 'What is your updated plan for' : 'What will you do with'} ${item.label}? Include the quantity, timing, and any prerequisite${item.owner ? ', and say who is responsible' : ''}.`
        : `${item.label}: the stated next action matches the current instruction.`,
      evidence,
    };
  });
}

/** The single detail a clarification question asks about; none for agreement or a changed plan. */
export function clarificationField(result: ItemComparison): ClaimField | undefined {
  return result.stale || result.status === 'agreement' ? undefined : result.findings[0]?.field;
}

/**
 * How often the current question for an item has already been answered without
 * resolving it, within the latest run of targeted replies for its current revision.
 */
export function clarificationAttempts(
  state: HandoverState,
  itemId: string,
): { attempts: number; bareReply: boolean } {
  const item = state.items.find((candidate) => candidate.id === itemId);
  const result = item && compareHandover(state).find((entry) => entry.itemId === itemId);
  const field = result && clarificationField(result);
  let attempts = 0;
  // Unresolved answers to any question about this item since one last supplied its value,
  // so a reply that only moves the question elsewhere still escalates.
  let unresolved = 0;
  let progressed = false;
  let bareReply: boolean | undefined;
  if (!item || !field) return { attempts, bareReply: false };
  for (const utterance of [...state.utterances].reverse()) {
    if (utterance.role !== 'incoming') continue;
    const targeted = utterance.readbackMode === 'targeted';
    if (targeted && !utterance.scopeItemIds?.includes(itemId)) continue;
    if (
      !targeted ||
      utterance.scopeItemIds?.length !== 1 ||
      utterance.itemRevisions[itemId] !== item.revision
    )
      break;
    const asked = utterance.answerField;
    if (asked && !progressed) {
      const claim = utterance.claims.find((entry) => entry.itemIds.includes(itemId));
      if (
        claim?.basis?.fields.includes(asked) &&
        claim[asked as keyof ParsedClaim] !== undefined &&
        !claim.uncertainFields.includes(asked)
      )
        progressed = true;
      else unresolved++;
    }
    if (asked !== field) continue;
    attempts++;
    bareReply ??= utterance.issues.some((issue) => issue.code === 'BARE_ACKNOWLEDGEMENT');
  }
  return { attempts: Math.max(attempts, unresolved), bareReply: !!bareReply };
}

const valueFields = ['action', 'quantity', 'unit', 'notBefore', 'condition', 'owner'] as const;
/** Details a short answer may supply for each clarification question. */
const answerableFields: Record<ClaimField, ClaimField[]> = {
  object: [],
  quantity: ['quantity', 'unit'],
  unit: ['unit', 'quantity'],
  action: ['action', 'condition', 'notBefore'],
  notBefore: ['notBefore'],
  condition: ['condition'],
  owner: ['owner'],
};

/**
 * Issues a short answer can resolve: each concerns one detail, and the words that raised it
 * belong to that detail ("about 8", "after 3", "until the address isn't confirmed"). Any
 * other issue on the earlier read-back (wording the rules could not account for, a
 * question, a negation, completed work, competing actions, a second time, an instruction
 * to someone else, a gate that may invert) covers the whole statement: a one-word answer
 * would erase it, so the worker must restate the item in full.
 */
const fragmentAnswerable = new Set([
  'AMBIGUOUS_TIME',
  'UNSUPPORTED_BEFORE_TIME',
  'QUALIFIED_QUANTITY',
  'AMBIGUOUS_QUANTITY',
  'UNSUPPORTED_QUANTITY_EXPRESSION',
  'NEGATIVE_QUANTITY',
  'INVALID_QUANTITY',
  'UNANCHORED_QUANTITY',
  'AMBIGUOUS_UNIT',
  'UNRECOGNISED_ACTION',
  'UNRECOGNISED_CONDITION',
  'COMPOUND_CONDITION',
  'AMBIGUOUS_HOLD_CONDITION',
  'NEGATED_PREREQUISITE',
  'AMBIGUOUS_OWNER',
  'BARE_ACKNOWLEDGEMENT',
  'NO_ANSWER_VALUE',
  'ANSWER_FOR_OTHER_DETAIL',
  'UNCERTAIN_ANSWER',
]);
const needsRestatement = (issues: ParseIssue[]) =>
  issues.some((issue) => !fragmentAnswerable.has(issue.code));

/**
 * Whether the item's current read-back has an issue no short answer may resolve, so the
 * guide asks for the whole item again instead of one detail.
 */
export function needsFullRestatement(state: HandoverState, itemId: string): boolean {
  const item = state.items.find((candidate) => candidate.id === itemId);
  const readback = state.readbacks[itemId];
  return (
    !!item &&
    !!readback &&
    readback.itemRevision === item.revision &&
    !readback.claims.some((claim) => claim.basis) &&
    needsRestatement(
      readback.issues.filter(
        (issue) => issue.itemIds.length === 0 || issue.itemIds.includes(itemId),
      ),
    )
  );
}

/** Every field the answer did not supply is unchanged from the earlier claim it completes. */
function inheritsFrom(claim: ParsedClaim, basis: ParsedClaim): boolean {
  const fields = claim.basis?.fields ?? [];
  return (
    claim.itemIds.length === 1 &&
    stable(basis.itemIds) === stable(claim.itemIds) &&
    (['object', ...valueFields] as const).every(
      (field) =>
        fields.includes(field) ||
        ((field === 'object' || stable(claim[field]) === stable(basis[field])) &&
          claim.uncertainFields.includes(field) === basis.uncertainFields.includes(field)),
    )
  );
}

/** Exported for revalidation, which re-derives stored short answers under current rules. */
export function mergeShortAnswer(
  parsed: ParsedTranscript,
  itemId: string,
  basisUtteranceId: string,
  basisClaims: ParsedClaim[],
  basisIssues: ParseIssue[],
): ParsedTranscript | undefined {
  const allowed = (parsed.answerField && answerableFields[parsed.answerField]) || [];
  const basis = basisClaims[0];
  const answer = parsed.claims[0];
  const bare = parsed.issues.find((issue) => issue.code === 'BARE_ACKNOWLEDGEMENT');
  if (
    !allowed.length ||
    basisClaims.length !== 1 ||
    !basis ||
    stable(basis.itemIds) !== stable([itemId]) ||
    parsed.claims.length > 1 ||
    (answer && (stable(answer.itemIds) !== stable([itemId]) || answer.basis)) ||
    answer?.uncertainFields.includes('object') ||
    // Whole-statement uncertainty in a full read-back is never answered by a fragment.
    (!basis.basis && needsRestatement(basisIssues)) ||
    // "I will not send eight …", then "send": the count and time were said under a
    // negation, so a one-word reversal never inherits them.
    (!!answer?.action &&
      !!basis.action &&
      answer.action !== basis.action &&
      statesProhibition(basis.evidence.text)) ||
    // Earlier uncertainty must stay visible unless this answer addresses it.
    basisIssues.some(
      (issue) =>
        !allowed.includes(issue.field) &&
        !(
          stable(issue.evidence) === stable(basis.evidence) &&
          basis.uncertainFields.includes(issue.field)
        ),
    )
  )
    return undefined;
  const fragment = !!answer && !answer.action && !answer.uncertainFields.includes('action');
  const fields: ClaimField[] = [];
  const otherFields: ClaimField[] = [];
  for (const field of valueFields) {
    if (!answer || (answer[field] === undefined && !answer.uncertainFields.includes(field)))
      continue;
    if (allowed.includes(field)) fields.push(field);
    else if (
      answer[field] !== undefined &&
      !answer.uncertainFields.includes(field) &&
      !basis.uncertainFields.includes(field) &&
      stable(answer[field]) === stable(basis[field])
    )
      continue; // An unchanged restatement adds nothing.
    else if (fragment) otherFields.push(field);
    else return undefined; // A different full statement replaces the earlier one.
  }
  // A prerequisite or time said for a different action ("send once the address is
  // confirmed", then "hold") may start rather than end the new action: ask again.
  const reopened =
    answer?.action && basis.action && answer.action !== basis.action
      ? (['condition', 'notBefore'] as const).filter(
          (field) =>
            !fields.includes(field) &&
            (basis[field] !== undefined || basis.uncertainFields.includes(field)),
        )
      : [];
  otherFields.push(...reopened);
  // "Until 3 PM", "unless the manager approves" said for an item the worker sends: the
  // gate may mean the opposite of a release prerequisite. Only a hold is ended by "until".
  const inverted =
    !!answer &&
    (fields.includes('action') ? answer.action : basis.action) !== 'hold' &&
    fields.some((field) => field === 'condition' || field === 'notBefore') &&
    hasUntilGate(answer.evidence.text);
  const invertedFields = inverted
    ? (['condition', 'notBefore'] as const).filter(
        (field) => !fields.includes(field) && !otherFields.includes(field),
      )
    : [];
  const evidence = answer?.evidence ??
    bare?.evidence ?? {
      utteranceId: parsed.utteranceId,
      start: 0,
      end: parsed.text.length,
      text: parsed.text,
    };
  const merged: ParsedClaim = {
    id: answer?.id ?? `${parsed.utteranceId}-claim-1`,
    itemIds: [itemId],
    uncertainFields: [],
    evidence,
    basis: {
      utteranceId: basisUtteranceId,
      claimId: basis.id,
      fields: [...fields, ...otherFields, ...invertedFields],
    },
  };
  for (const field of valueFields) {
    const source = fields.includes(field)
      ? answer
      : otherFields.includes(field) || (invertedFields as ClaimField[]).includes(field)
        ? undefined
        : basis;
    if (source?.[field] !== undefined) Object.assign(merged, { [field]: source[field] });
  }
  for (const field of ['object', ...valueFields] as const)
    if (
      otherFields.includes(field) ||
      (fields.includes(field)
        ? answer!.uncertainFields.includes(field)
        : basis.uncertainFields.includes(field))
    )
      merged.uncertainFields.push(field);
  if (inverted)
    for (const field of ['condition', 'notBefore'] as const)
      if (!merged.uncertainFields.includes(field)) merged.uncertainFields.push(field);
  // The item is known in a one-item clarification: an unusable reply ("Nagpur",
  // "banana") keeps the earlier statement and asks the same detail again.
  const issues = parsed.issues.map((issue) =>
    issue.field === 'object' ? { ...issue, field: parsed.answerField! } : issue,
  );
  // An earlier issue on a detail this answer did not supply stays visible with that detail.
  for (const issue of basisIssues)
    if (
      !fields.includes(issue.field) &&
      merged.uncertainFields.includes(issue.field) &&
      !issues.some((kept) => kept.code === issue.code && kept.field === issue.field)
    )
      // Evidence must quote this answer; the earlier words stay shown through the basis.
      issues.push({ ...issue, itemIds: [itemId], evidence });
  if (inverted && !issues.some((issue) => issue.code === 'INVERTED_GATE'))
    issues.push({
      code: 'INVERTED_GATE',
      message:
        '“Until” or “unless” with this action may mean the opposite of a release prerequisite. Say what must happen before release, or hold the item until then.',
      itemIds: [itemId],
      field: 'condition',
      evidence,
    });
  // A detail outside the question is neither accepted nor allowed to stand unchallenged.
  for (const field of otherFields)
    issues.push(
      reopened.includes(field as (typeof reopened)[number])
        ? {
            code: 'AMBIGUOUS_HOLD_CONDITION',
            message:
              'This detail was said for a different action. Say it again for the new action, for example "hold until" the release prerequisite.',
            itemIds: [itemId],
            field,
            evidence,
          }
        : {
            code: 'ANSWER_FOR_OTHER_DETAIL',
            message:
              'This reply states a different detail than the one asked. Restate it for this item.',
            itemIds: [itemId],
            field,
            evidence,
          },
    );
  if (!bare && fields.length === 0 && otherFields.length === 0)
    issues.push({
      code: 'NO_ANSWER_VALUE',
      message: 'This reply does not state the detail that was asked. Say the value itself.',
      itemIds: [itemId],
      field: parsed.answerField!,
      evidence,
    });
  return { ...parsed, claims: [merged], issues };
}

/**
 * Completes a short single-item answer ("8", "after 3 PM") with the incoming
 * worker's own current read-back of that item. Only the asked detail comes from
 * the answer; nothing is ever taken from the expected plan. Anything that cannot
 * be merged safely is returned unchanged and replaces the item's read-back as before.
 */
export function completeShortAnswer(
  state: HandoverState,
  parsed: ParsedTranscript,
): ParsedTranscript {
  const itemId = parsed.scopeItemIds?.length === 1 ? parsed.scopeItemIds[0]! : undefined;
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (
    parsed.role !== 'incoming' ||
    parsed.readbackMode === 'full' ||
    !parsed.answerField ||
    !item ||
    parsed.claims.some((claim) => claim.basis)
  )
    return parsed;
  const existing = state.utterances.find(
    (utterance) => utterance.utteranceId === parsed.utteranceId,
  );
  if (existing) {
    // A retried request is completed exactly as it was first recorded.
    const reference = existing.claims.find((claim) => claim.basis)?.basis;
    const source = state.utterances.find(
      (utterance) => utterance.utteranceId === reference?.utteranceId,
    );
    if (source?.parser !== 'local-rules') return parsed;
    return (
      mergeShortAnswer(
        parsed,
        item.id,
        source.utteranceId,
        source.claims.filter((claim) => claim.itemIds.includes(item.id)),
        source.issues.filter(
          (issue) => issue.itemIds.length === 0 || issue.itemIds.includes(item.id),
        ),
      ) ?? parsed
    );
  }
  const readback = state.readbacks[item.id];
  const result = compareHandover(state).find((entry) => entry.itemId === item.id)!;
  if (
    !readback ||
    // A model reading cannot be re-derived offline, so a merge on top of it
    // could never be revalidated; the answer stands alone instead.
    state.utterances.find((utterance) => utterance.utteranceId === readback.utteranceId)?.parser !==
      'local-rules' ||
    readback.itemRevision !== item.revision ||
    parsed.itemRevisions[item.id] !== item.revision ||
    clarificationField(result) !== parsed.answerField
  )
    return parsed;
  return (
    mergeShortAnswer(parsed, item.id, readback.utteranceId, readback.claims, readback.issues) ??
    parsed
  );
}

/** Rejects stale or ungrounded extraction; records independent incoming intent. */
export function recordReadback(
  state: HandoverState,
  raw: ParsedTranscript,
  options: Pick<SubmitReadbackOptions, 'at' | 'mode' | 'scopeItemIds'> = {},
): HandoverState {
  if (raw.role !== 'incoming')
    throw new DomainError(
      'WRONG_ROLE',
      'Only the incoming participant can provide the independent read-back.',
    );
  const requestedScope = options.scopeItemIds ?? raw.scopeItemIds;
  const mode = options.mode ?? raw.readbackMode ?? (requestedScope ? 'targeted' : 'full');
  if (
    (options.mode && raw.readbackMode && options.mode !== raw.readbackMode) ||
    (options.scopeItemIds &&
      raw.scopeItemIds &&
      stable([...options.scopeItemIds].sort()) !== stable([...raw.scopeItemIds].sort())) ||
    (mode === 'full' && requestedScope !== undefined) ||
    (mode === 'targeted' &&
      (!requestedScope?.length ||
        new Set(requestedScope).size !== requestedScope.length ||
        requestedScope.some((id) => !state.items.some((item) => item.id === id))))
  )
    throw new DomainError(
      'INVALID_READBACK_SCOPE',
      'Choose either a full recheck or explicit current items for a targeted reply.',
    );
  const normalized: ParsedTranscript = {
    ...raw,
    readbackMode: mode,
    ...(mode === 'targeted' ? { scopeItemIds: [...requestedScope!] } : {}),
  };
  const existing = state.utterances.find((utterance) => utterance.utteranceId === raw.utteranceId);
  if (existing) {
    const { createdAt: _createdAt, rulesVersion: _rulesVersion, ...previous } = existing;
    // Legacy stored recordings have no mode metadata. A byte-identical retry is
    // still idempotent and must never reapply the old result to a changed plan.
    if (stable({ ...previous, readbackMode: previous.readbackMode ?? mode }) === stable(normalized))
      return state;
    throw new DomainError(
      'DUPLICATE_UTTERANCE',
      'This recording ID was already used for different content.',
    );
  }
  const parsed = validateParsed(normalized, state.items);
  const affected = new Set(mode === 'full' ? state.items.map((item) => item.id) : requestedScope!);
  if (
    mode === 'targeted' &&
    [...parsed.claims, ...parsed.issues].some((part) =>
      part.itemIds.some((id) => !affected.has(id)),
    )
  )
    throw new DomainError(
      'OUTSIDE_READBACK_SCOPE',
      'This reply also names another item. Recheck the full handover or clarify only the selected items.',
    );
  for (const id of affected) {
    const item = state.items.find((candidate) => candidate.id === id)!;
    if (parsed.itemRevisions[id] !== item.revision)
      throw new DomainError(
        'STALE_EXTRACTION',
        'The plan changed while this recording was being processed. Review the current instruction and record again.',
      );
  }
  for (const claim of parsed.claims) {
    if (!claim.basis) continue;
    const id = claim.itemIds[0]!;
    const readback = state.readbacks[id];
    const basis =
      readback?.utteranceId === claim.basis.utteranceId &&
      readback.itemRevision === state.items.find((item) => item.id === id)!.revision
        ? readback.claims.find((candidate) => candidate.id === claim.basis!.claimId)
        : undefined;
    if (!basis || !inheritsFrom(claim, basis))
      throw new DomainError(
        'INVALID_ANSWER_BASIS',
        'This short answer no longer matches the current read-back. Explain the plan for this item again.',
      );
  }
  const at = validTimestamp(options.at ?? now());
  if (
    Date.parse(at) < Date.parse(state.createdAt) ||
    [...affected].some(
      (id) => state.readbacks[id] && Date.parse(at) < Date.parse(state.readbacks[id]!.createdAt),
    )
  )
    throw new DomainError(
      'STALE_UTTERANCE',
      'This recording is older than the current read-back. It cannot replace the newer plan.',
    );
  const readbacks = { ...state.readbacks };
  const confirmations = { ...state.confirmations };
  for (const id of affected) {
    readbacks[id] = {
      itemId: id,
      itemRevision: state.items.find((item) => item.id === id)!.revision,
      utteranceId: parsed.utteranceId,
      claims: clone(parsed.claims.filter((claim) => claim.itemIds.includes(id))),
      issues: clone(
        parsed.issues.filter((issue) => issue.itemIds.length === 0 || issue.itemIds.includes(id)),
      ),
      createdAt: at,
    };
    delete confirmations[id];
  }
  return appendEvent(
    {
      ...state,
      readbacks,
      confirmations,
      ...(state.recheckNotice && {
        recheckNotice: remainingRecheckNotice(state, affected),
      }),
      utterances: [...state.utterances, { ...stampInterpretation(clone(parsed)), createdAt: at }],
    },
    {
      type: 'readback-recorded',
      itemIds: [...affected],
      message:
        mode === 'full'
          ? 'Incoming participant rechecked the complete handover; omitted items need clarification.'
          : 'Incoming participant clarified the selected items; other acknowledgements were retained.',
      createdAt: at,
    },
  );
}

export function submitReadback(
  state: HandoverState,
  textOrParsed: string | ParsedTranscript,
  options: SubmitReadbackOptions = {},
): HandoverState {
  const parsed =
    typeof textOrParsed === 'string'
      ? parseTranscript({
          text: textOrParsed,
          role: 'incoming',
          language: options.language ?? state.participantLanguages?.incoming ?? state.language,
          items: state.items,
          utteranceId: options.utteranceId,
          scopeItemIds: options.scopeItemIds,
          ...(options.answerField ? { answerField: options.answerField } : {}),
        })
      : textOrParsed;
  return recordReadback(state, completeShortAnswer(state, parsed), {
    at: options.at,
    mode: options.mode,
    scopeItemIds: options.scopeItemIds,
  });
}

/** The user reviews a proposed change before this function is called. */
export function reviseItem(
  state: HandoverState,
  itemId: string,
  patch: ItemPatch,
  options: { at?: string; expectedRevision?: number } = {},
): HandoverState {
  const previous = state.items.find((item) => item.id === itemId);
  if (!previous) throw new DomainError('UNKNOWN_ITEM', 'This item no longer exists.');
  if (options.expectedRevision !== undefined && options.expectedRevision !== previous.revision)
    throw new DomainError(
      'STALE_REVISION',
      'This instruction has changed. Review its current version before editing.',
    );
  const next = validatedItem({ ...previous, ...clone(patch), id: previous.id }, previous.revision);
  if (
    stable({ ...previous, evidence: [], evidenceFields: undefined }) ===
    stable({ ...next, evidence: [], evidenceFields: undefined })
  )
    return state;
  // A manual change is grounded in the revision event, not in an obsolete voice quote.
  if (patch.evidence === undefined || patch.evidence.length === 0) {
    next.evidence = [];
    next.evidenceFields = [];
  } else {
    next.evidenceFields = (
      ['quantity', 'unit', 'action', 'notBefore', 'condition', 'owner'] as const
    ).filter((field) => patch[field] !== undefined);
    if (patch.label !== undefined || patch.aliases !== undefined)
      next.evidenceFields.push('object');
  }
  next.revision++;
  const confirmations = { ...state.confirmations };
  delete confirmations[itemId];
  // A group-count claim depends on every member's quantity/unit; other action-only edits remain item-specific.
  if (
    previous.quantity !== next.quantity ||
    canonicalUnit(previous.unit) !== canonicalUnit(next.unit)
  ) {
    for (const [id, readback] of Object.entries(state.readbacks))
      if (readback.claims.some((claim) => claim.itemIds.includes(itemId))) delete confirmations[id];
  }
  const at = validTimestamp(options.at ?? now());
  return appendEvent(
    {
      ...state,
      items: state.items.map((item) => (item.id === itemId ? next : item)),
      confirmations,
    },
    {
      type: 'item-revised',
      itemIds: [itemId],
      message: `${previous.label} changed to revision ${next.revision}. Its earlier confirmation is no longer valid.`,
      createdAt: at,
      before: [clone(previous)],
      after: [clone(next)],
    },
  );
}

export const updateItem = reviseItem;

export function releaseItem(
  state: HandoverState,
  itemId: string,
  note = 'Release condition confirmed by the outgoing worker.',
  options: { at?: string; expectedRevision?: number } = {},
): HandoverState {
  const current = state.items.find((item) => item.id === itemId);
  if (!current) throw new DomainError('UNKNOWN_ITEM', 'This item no longer exists.');
  if (current.action !== 'hold')
    throw new DomainError('NOT_ON_HOLD', 'This item is not currently on hold.');
  const revised = reviseItem(state, itemId, { action: 'dispatch', condition: null }, options);
  const event = revised.events.at(-1)!;
  return {
    ...revised,
    events: [
      ...revised.events.slice(0, -1),
      {
        ...event,
        message: `${current.label} instruction changed to dispatch: ${note.slice(0, 700)} A new read-back is required for this item.`,
      },
    ],
  };
}

export function confirmItem(
  state: HandoverState,
  itemId: string,
  actor = state.incomingName,
  expectedRevision?: number,
): HandoverState {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new DomainError('UNKNOWN_ITEM', 'This item no longer exists.');
  if (expectedRevision !== undefined && expectedRevision !== item.revision)
    throw new DomainError('STALE_REVISION', 'This confirmation refers to an old instruction.');
  const comparison = compareHandover(state).find((result) => result.itemId === itemId)!;
  if (comparison.status !== 'agreement' || comparison.stale)
    throw new DomainError(
      'UNRESOLVED_READBACK',
      'Resolve the current read-back before confirming this item.',
    );
  if (comparison.confirmed) return state;
  const name = actor.trim();
  if (!name || name.length > 100)
    throw new DomainError(
      'INVALID_ACTOR',
      'Provide a participant name between 1 and 100 characters.',
    );
  const at = now();
  return appendEvent(
    {
      ...state,
      confirmations: {
        ...state.confirmations,
        [itemId]: {
          itemId,
          itemRevision: item.revision,
          utteranceId: state.readbacks[itemId]!.utteranceId,
          actor: name,
          createdAt: at,
        },
      },
    },
    {
      type: 'item-confirmed',
      itemIds: [itemId],
      message: `${name} confirmed ${item.label}, revision ${item.revision}.`,
      createdAt: at,
    },
  );
}

export function addItem(state: HandoverState, input: ItemInput): HandoverState {
  const item = validatedItem(input);
  if (state.items.some((existing) => existing.id === item.id))
    throw new DomainError('DUPLICATE_ITEM', 'This item ID is already in use.');
  if (state.items.length >= 100)
    throw new DomainError('TOO_MANY_ITEMS', 'This prototype supports up to 100 board items.');
  return appendEvent(
    { ...state, items: [...state.items, item] },
    {
      type: 'item-added',
      itemIds: [item.id],
      message: `${item.label} added; a read-back is required.`,
      createdAt: now(),
      after: [clone(item)],
    },
  );
}

export function removeItem(state: HandoverState, itemId: string): HandoverState {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new DomainError('UNKNOWN_ITEM', 'This item no longer exists.');
  const readbacks = { ...state.readbacks };
  const confirmations = { ...state.confirmations };
  for (const [id, readback] of Object.entries(readbacks))
    if (id === itemId || readback.claims.some((claim) => claim.itemIds.includes(itemId))) {
      delete readbacks[id];
      delete confirmations[id];
    }
  return appendEvent(
    {
      ...state,
      items: state.items.filter((candidate) => candidate.id !== itemId),
      readbacks,
      confirmations,
      ...(state.recheckNotice && {
        recheckNotice: remainingRecheckNotice(state, new Set([itemId])),
      }),
    },
    {
      type: 'item-removed',
      itemIds: [itemId],
      message: `${item.label} removed from this handover.`,
      createdAt: now(),
      before: [clone(item)],
    },
  );
}

export interface RestoreOptions extends RevalidationOptions {
  /**
   * `false` only checks shape and cross-record integrity, e.g. to tell whether
   * saved data is readable or that an already revalidated in-memory state is
   * still schema-valid. Trust boundaries (load, import, restore) keep the default.
   */
  revalidate?: boolean;
}

/**
 * Validate untrusted local/imported JSON, including cross-record consistency,
 * then recheck saved interpretations against the current rules. Pass
 * `origin: 'import'` for files from outside this browser and `previous` for an
 * in-app change of an already restored state (see `revalidateInterpretations`).
 */
export function restoreHandover(value: unknown, options: RestoreOptions = {}): HandoverState {
  const restored = validateAndRevalidate(value, options);
  if (options.revalidate !== false) restoredStates.add(restored);
  return restored;
}

// States returned by a revalidating restore. App state is never mutated in
// place, so saving such an object again needs no second validation.
const restoredStates = new WeakSet<HandoverState>();

/** True for an object returned by `restoreHandover` with revalidation. */
export function isRestoredHandover(state: HandoverState): boolean {
  return restoredStates.has(state);
}

/** Shown when a change would exceed the supported history size. */
export const HISTORY_LIMIT_MESSAGE =
  'This handover has reached its history limit (5,000 events or 2,000 recordings), so this change was not saved. The full history is kept: export this handover and start a new one to continue.';

function validateAndRevalidate(value: unknown, options: RestoreOptions): HandoverState {
  const result = handoverStateSchema.safeParse(value);
  if (!result.success) {
    // A full history must not be trimmed and must not be reported as a broken file.
    if (
      result.error.issues.some(
        (issue) =>
          issue.code === 'too_big' &&
          issue.path.length === 1 &&
          (issue.path[0] === 'events' || issue.path[0] === 'utterances'),
      )
    )
      throw new DomainError('HISTORY_LIMIT', HISTORY_LIMIT_MESSAGE);
    throw new DomainError('INVALID_BACKUP', 'This file is not a supported BolRelay handover.');
  }
  const state = result.data;
  const ids = new Set(state.items.map((item) => item.id));
  if (ids.size !== state.items.length)
    throw new DomainError('INVALID_BACKUP', 'The handover has duplicate item IDs.');
  if (
    state.recheckNotice &&
    (new Set(state.recheckNotice.itemIds).size !== state.recheckNotice.itemIds.length ||
      state.recheckNotice.itemIds.some((id) => !ids.has(id)))
  )
    throw new DomainError('INVALID_BACKUP', 'The system recheck notice references invalid items.');
  const utteranceIds = new Set(state.utterances.map((utterance) => utterance.utteranceId));
  if (utteranceIds.size !== state.utterances.length)
    throw new DomainError('INVALID_BACKUP', 'The handover has duplicate recording IDs.');
  // Historical utterances may reference items that have subsequently been removed.
  const historicIds = new Set([
    ...ids,
    ...state.events.flatMap((event) => event.before?.map((item) => item.id) ?? []),
  ]);
  for (const [index, utterance] of state.utterances.entries()) {
    const historicItems = [...historicIds].map((id) => ({ id }) as HandoverItem);
    validateParsed(utterance, historicItems);
    for (const claim of utterance.claims) {
      if (!claim.basis) continue;
      const id = claim.itemIds[0]!;
      // The basis must be the worker's latest earlier statement covering this item;
      // a read-back superseded by a later one is no longer theirs to complete.
      const source = state.utterances
        .slice(0, index)
        .reverse()
        .find(
          (candidate) =>
            candidate.role === 'incoming' &&
            (!candidate.scopeItemIds || candidate.scopeItemIds.includes(id)),
        );
      const basis =
        source?.utteranceId === claim.basis.utteranceId
          ? source.claims.find((candidate) => candidate.id === claim.basis!.claimId)
          : undefined;
      if (
        !source ||
        source.role !== 'incoming' ||
        source.itemRevisions[id] !== utterance.itemRevisions[id] ||
        !basis ||
        !inheritsFrom(claim, basis)
      )
        throw new DomainError(
          'INVALID_BACKUP',
          'A short answer does not match the earlier read-back it completes.',
        );
    }
  }
  for (const item of state.items) {
    if (item.evidenceFields?.length && item.evidence.length === 0)
      throw new DomainError(
        'INVALID_BACKUP',
        'An instruction change lists source fields without source evidence.',
      );
    for (const evidence of item.evidence) {
      const source = state.utterances.find(
        (utterance) => utterance.utteranceId === evidence.utteranceId,
      );
      if (
        !source ||
        source.role !== 'outgoing' ||
        evidence.end > source.text.length ||
        evidence.text !== source.text.slice(evidence.start, evidence.end) ||
        !source.claims.some(
          (claim) => claim.itemIds.includes(item.id) && stable(claim.evidence) === stable(evidence),
        )
      )
        throw new DomainError(
          'INVALID_BACKUP',
          'An outgoing instruction excerpt does not match its original recording and item.',
        );
    }
    // New spoken edits explicitly identify the fields their excerpts support.
    // Unmentioned inherited fields must not be attributed to the new quotation.
    for (const field of item.evidenceFields ?? []) {
      const supported = item.evidence.some((evidence) => {
        const source = state.utterances.find(
          (utterance) => utterance.utteranceId === evidence.utteranceId,
        )!;
        return source.claims.some((claim) => {
          if (
            !claim.itemIds.includes(item.id) ||
            stable(claim.evidence) !== stable(evidence) ||
            claim.uncertainFields.includes(field)
          )
            return false;
          if (field === 'object') return true;
          if (field === 'quantity')
            return claim.itemIds.length === 1 && claim.quantity === item.quantity;
          if (field === 'unit')
            return (
              claim.unit !== undefined && canonicalUnit(claim.unit) === canonicalUnit(item.unit)
            );
          if (field === 'condition')
            return (
              claim.condition !== undefined &&
              canonicalCondition(claim.condition ?? '') === canonicalCondition(item.condition ?? '')
            );
          if (field === 'owner')
            return (
              claim.owner !== undefined &&
              normalizeText(claim.owner ?? '') === normalizeText(item.owner ?? '')
            );
          return claim[field] !== undefined && claim[field] === item[field];
        });
      });
      if (!supported)
        throw new DomainError(
          'INVALID_BACKUP',
          'An outgoing change attributes a field to an excerpt that does not support the stored value.',
        );
    }
  }
  for (const [id, readback] of Object.entries(state.readbacks)) {
    const source = state.utterances.find(
      (utterance) => utterance.utteranceId === readback.utteranceId,
    );
    const item = state.items.find((candidate) => candidate.id === id);
    if (
      !item ||
      id !== readback.itemId ||
      !source ||
      source.role !== 'incoming' ||
      (source.readbackMode === 'targeted' && !source.scopeItemIds?.includes(id)) ||
      readback.itemRevision > item.revision ||
      source.itemRevisions[id] !== readback.itemRevision ||
      readback.claims.some(
        (claim) => !claim.itemIds.includes(id) || claim.itemIds.some((target) => !ids.has(target)),
      )
    )
      throw new DomainError('INVALID_BACKUP', 'The handover contains an inconsistent read-back.');
    if (
      stable(readback.claims) !==
        stable(source.claims.filter((claim) => claim.itemIds.includes(id))) ||
      stable(readback.issues) !==
        stable(
          source.issues.filter((issue) => issue.itemIds.length === 0 || issue.itemIds.includes(id)),
        )
    )
      throw new DomainError('INVALID_BACKUP', 'A read-back does not match its original recording.');
  }
  const comparisons = compareHandover(state);
  for (const [id, confirmation] of Object.entries(state.confirmations)) {
    const comparison = comparisons.find((c) => c.itemId === id);
    if (confirmation.itemId !== id || !comparison?.confirmed)
      throw new DomainError(
        'INVALID_BACKUP',
        'The handover contains an invalid or stale confirmation.',
      );
  }
  // Earlier recordings lack explicit full/targeted intent and were
  // interpreted before ambiguity guards were strengthened. Keep their original
  // statements and audit history, but never restore those results as active
  // understanding or acknowledgements. Validate everything above first so this
  // migration cannot conceal inconsistent or tampered source records.
  const legacyItemIds = Object.entries(state.readbacks)
    .filter(([, readback]) => {
      const source = state.utterances.find(
        (utterance) => utterance.utteranceId === readback.utteranceId,
      )!;
      return source.readbackMode === undefined;
    })
    .map(([id]) => id);
  if (options.revalidate === false) return state;
  // Saved approvals are then rechecked against the current interpretation rules.
  if (legacyItemIds.length === 0) {
    const unchanged = clone(state);
    const revalidated = revalidateInterpretations(unchanged, options);
    return revalidated === unchanged ? revalidated : canonical(revalidated);
  }

  const migrated = clone(state);
  for (const id of legacyItemIds) {
    delete migrated.readbacks[id];
    delete migrated.confirmations[id];
  }
  const at = now();
  migrated.updatedAt = latest(migrated.updatedAt, at);
  migrated.recheckNotice = {
    reason: 'legacy-interpretation',
    itemIds: [...new Set([...(state.recheckNotice?.itemIds ?? []), ...legacyItemIds])],
    createdAt: state.recheckNotice?.createdAt ?? at,
  };
  // A full history is retained even at the supported event limit. The separate
  // persisted system notice remains visible without adding an invalid 5001st event.
  return canonical(
    revalidateInterpretations(
      migrated.events.length < 5_000
        ? appendEvent(migrated, {
            type: 'interpretation-upgraded',
            itemIds: legacyItemIds,
            message:
              'System update: earlier read-backs need a fresh check after interpretation rules changed. Original statements and history were retained; no participant acknowledgement was added.',
            createdAt: at,
          })
        : migrated,
      options,
    ),
  );
}

/**
 * Re-parses a state that revalidation changed, so added keys (a recheck notice,
 * source review markers, events) are in schema order. A later load of the saved
 * text then serializes identically and is not mistaken for new work.
 */
function canonical(state: HandoverState): HandoverState {
  const result = handoverStateSchema.safeParse(state);
  if (!result.success)
    throw new DomainError('INVALID_BACKUP', 'This file is not a supported BolRelay handover.');
  return result.data;
}

export function getHandoverSummary(state: HandoverState) {
  const comparisons = compareHandover(state);
  return {
    total: comparisons.length,
    confirmed: comparisons.filter((item) => item.confirmed).length,
    agreement: comparisons.filter((item) => item.status === 'agreement').length,
    contradictions: comparisons.filter((item) => item.status === 'contradiction').length,
    omissions: comparisons.filter((item) => item.status === 'omission').length,
    uncertainties: comparisons.filter((item) => item.status === 'uncertainty').length,
    complete: comparisons.length > 0 && comparisons.every((item) => item.confirmed),
  };
}
