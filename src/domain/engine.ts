import { canonicalCondition, canonicalUnit, normalizeText, parseTranscript } from './parser';
import { handoverItemSchema, handoverStateSchema, parsedTranscriptSchema } from './schema';
import type {
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
  ParsedClaim,
  ParsedTranscript,
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

function validateParsed(parsed: ParsedTranscript, items: HandoverItem[]) {
  const result = parsedTranscriptSchema.safeParse(parsed);
  if (!result.success)
    throw new DomainError(
      'INVALID_TRANSCRIPT',
      result.error.issues.map((issue) => issue.message).join('; '),
    );
  const ids = new Set(items.map((item) => item.id));
  const claimIds = new Set<string>();
  for (const claim of result.data.claims) {
    if (claimIds.has(claim.id))
      throw new DomainError('DUPLICATE_CLAIM', 'Claim IDs must be unique.');
    claimIds.add(claim.id);
    if (new Set(claim.itemIds).size !== claim.itemIds.length)
      throw new DomainError('DUPLICATE_REFERENCE', 'A claim cannot count the same item twice.');
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

/** Compare only explicit facts; missing and uncertain information never become agreement. */
export function compareHandover(state: HandoverState): ItemComparison[] {
  return state.items.map((item) => {
    const readback = state.readbacks[item.id];
    const stale = !!readback && readback.itemRevision !== item.revision;
    const evidence = readback?.claims.map((claim) => claim.evidence) ?? [];
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
        ? `${item.label}: ${priority.message}`
        : `${item.label}: the stated next action matches the current instruction.`,
      evidence,
    };
  });
}

/** Rejects stale or ungrounded extraction; records independent incoming intent. */
export function recordReadback(
  state: HandoverState,
  raw: ParsedTranscript,
  options: { at?: string } = {},
): HandoverState {
  if (raw.role !== 'incoming')
    throw new DomainError(
      'WRONG_ROLE',
      'Only the incoming participant can provide the independent read-back.',
    );
  const existing = state.utterances.find((utterance) => utterance.utteranceId === raw.utteranceId);
  if (existing) {
    const { createdAt: _createdAt, ...previous } = existing;
    if (stable(previous) === stable(raw)) return state;
    throw new DomainError(
      'DUPLICATE_UTTERANCE',
      'This recording ID was already used for different content.',
    );
  }
  const parsed = validateParsed(raw, state.items);
  const affected = new Set([
    ...parsed.claims.flatMap((claim) => claim.itemIds),
    ...parsed.issues.flatMap((issue) => issue.itemIds),
  ]);
  if (parsed.issues.some((issue) => issue.itemIds.length === 0) || affected.size === 0)
    for (const item of state.items) affected.add(item.id);
  for (const id of affected) {
    const item = state.items.find((candidate) => candidate.id === id)!;
    if (parsed.itemRevisions[id] !== item.revision)
      throw new DomainError(
        'STALE_EXTRACTION',
        'The plan changed while this recording was being processed. Review the current instruction and record again.',
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
      utterances: [...state.utterances, { ...clone(parsed), createdAt: at }],
    },
    {
      type: 'readback-recorded',
      itemIds: [...affected],
      message: 'Incoming participant explained their intended actions.',
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
          language: options.language ?? state.language,
          items: state.items,
          utteranceId: options.utteranceId,
          scopeItemIds: options.scopeItemIds,
        })
      : textOrParsed;
  return recordReadback(state, parsed, { at: options.at });
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
  if (stable(previous) === stable(next)) return state;
  // A manual change is grounded in the revision event, not in an obsolete voice quote.
  if (patch.evidence === undefined) next.evidence = [];
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
        message: `${current.label} released: ${note.slice(0, 700)} A new read-back is required for this item.`,
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

/** Validate untrusted local/imported JSON, including cross-record consistency. */
export function restoreHandover(value: unknown): HandoverState {
  const result = handoverStateSchema.safeParse(value);
  if (!result.success)
    throw new DomainError('INVALID_BACKUP', 'This file is not a supported BolRelay handover.');
  const state = result.data;
  const ids = new Set(state.items.map((item) => item.id));
  if (ids.size !== state.items.length)
    throw new DomainError('INVALID_BACKUP', 'The handover has duplicate item IDs.');
  const utteranceIds = new Set(state.utterances.map((utterance) => utterance.utteranceId));
  if (utteranceIds.size !== state.utterances.length)
    throw new DomainError('INVALID_BACKUP', 'The handover has duplicate recording IDs.');
  // Historical utterances may reference items that have subsequently been removed.
  const historicIds = new Set([
    ...ids,
    ...state.events.flatMap((event) => event.before?.map((item) => item.id) ?? []),
  ]);
  for (const utterance of state.utterances) {
    const historicItems = [...historicIds].map((id) => ({ id }) as HandoverItem);
    validateParsed(utterance, historicItems);
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
  return clone(state);
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
