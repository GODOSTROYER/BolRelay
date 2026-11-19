import { createHandover, restoreHandover } from './engine';
import { canonicalUnit, normalizeNumbers, parseTranscript } from './parser';
import { stampInterpretation } from './rulesVersion';
import type {
  CreateHandoverInput,
  HandoverItem,
  HandoverState,
  ItemInput,
  Language,
  ParsedTranscript,
} from './types';

export type DraftProblemCode =
  'empty' | 'too_many' | 'identity' | 'duplicate' | 'unclear' | 'quantity' | 'hold';
export interface InstructionDraft {
  text: string;
  language: Language;
  items: ItemInput[];
  parsed: ParsedTranscript | null;
  problems: { code: DraftProblemCode; sentence?: number }[];
}

const units = new Set(['parcel', 'box', 'carton', 'piece']);
const boundaries =
  /^(?:after|before|until|unless|once|when|at|and|or|but|now|immediately|send|dispatch|hold|keep|pack|collect|ship|release|बजे|वाजता|वाजल्यानंतर|नंतर|बाद|भेजना|भेजो|भेजें|भेज|पाठवा|पाठवेन|रोक|रखना|रखो|ठेवा|थांबवा|पता|पत्ता|पत्त्याची|दोपहर|दुपार|दुपारी|शाम|सकाळी|सकाळ|सुबह|रात)$/iu;
const connectors = /^(?:to|for|the|of|के|की|को|का|चे|ची|ला)$/iu;

/** Bounded identity discovery, followed by the same conservative statement parser.
 * No catalog answers exist at creation time. Never promote a partial draft.
 */
export function draftInstructions(text: string, language: Language): InstructionDraft {
  const original = text.trim();
  const draft: InstructionDraft = {
    text: original,
    language,
    items: [],
    parsed: null,
    problems: [],
  };
  if (!original) return { ...draft, problems: [{ code: 'empty' }] };
  const sentences = original
    .split(/[.!?;।\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (sentences.length > 12 || original.length > 4000)
    return { ...draft, problems: [{ code: 'too_many' }] };
  const candidates: HandoverItem[] = [];
  const known = new Set<string>();
  sentences.forEach((sentence, index) => {
    // A new catalog has no established grouping or allocation. Do not turn an
    // object list, exception, or multiple parcel IDs into one guessed object.
    if (
      /\b(?:and|or|except|but|plus|excluding)\b|(?:^|\s)(?:और|आणि|या|किंवा|सिवाय|वगळून)(?:\s|$)/iu.test(
        sentence,
      ) ||
      (sentence.match(/(?<![\p{L}\p{N}])[a-z]{1,4}-?\d{1,8}(?![\p{L}\p{N}])/giu)?.length ?? 0) > 1
    ) {
      draft.problems.push({ code: 'identity', sentence: index + 1 });
      return;
    }
    if (/\b(?:minus|negative)\b|[-−]\s*\d|उणे|ऋण/iu.test(sentence)) {
      draft.problems.push({ code: 'quantity', sentence: index + 1 });
      return;
    }
    const tokens = [...sentence.matchAll(/[\p{L}\p{M}\p{N}]+(?:[-'][\p{L}\p{M}\p{N}]+)*/gu)].map(
      (match) => match[0],
    );
    const unitIndexes = tokens.flatMap((token, i) => (units.has(canonicalUnit(token)) ? [i] : []));
    if (unitIndexes.length !== 1) {
      draft.problems.push({ code: 'identity', sentence: index + 1 });
      return;
    }
    const unitIndex = unitIndexes[0]!;
    let quantityIndex = -1;
    for (let i = 0; i < unitIndex; i++)
      if (/^\d+(?:\.\d+)?$/.test(normalizeNumbers(tokens[i]!))) quantityIndex = i;
    if (quantityIndex < 0) {
      draft.problems.push({ code: 'quantity', sentence: index + 1 });
      return;
    }
    const before = tokens
      .slice(quantityIndex + 1, unitIndex)
      .filter((token) => !connectors.test(token));
    const after: string[] = [];
    for (const token of tokens.slice(unitIndex + 1)) {
      if (boundaries.test(token) || /^\d+$/.test(normalizeNumbers(token))) break;
      if (!connectors.test(token)) after.push(token);
    }
    const identity = before.length ? before : after;
    if (
      !identity.length ||
      identity.length > 4 ||
      identity.some((token) => boundaries.test(token))
    ) {
      draft.problems.push({ code: 'identity', sentence: index + 1 });
      return;
    }
    const label = identity.join(' ');
    const key = label.normalize('NFC').toLocaleLowerCase();
    if (known.has(key)) {
      draft.problems.push({ code: 'duplicate', sentence: index + 1 });
      return;
    }
    known.add(key);
    const explicitId = identity.find((token) => /^[a-z]{1,4}\d{1,8}$/i.test(token));
    const id = explicitId?.toUpperCase() ?? `ITEM${index + 1}`;
    if (candidates.some((item) => item.id === id)) {
      draft.problems.push({ code: 'duplicate', sentence: index + 1 });
      return;
    }
    candidates.push({
      id,
      label,
      aliases: [label],
      quantity: 1,
      unit: canonicalUnit(tokens[unitIndex]!),
      action: 'pack',
      notBefore: null,
      condition: null,
      owner: null,
      revision: 1,
      evidence: [],
    });
  });
  if (draft.problems.length) return draft;
  const parsed = parseTranscript({ text: original, language, role: 'outgoing', items: candidates });
  draft.parsed = parsed;
  if (parsed.issues.length || parsed.claims.some((claim) => claim.uncertainFields.length))
    draft.problems.push({ code: 'unclear' });
  for (const candidate of candidates) {
    const claims = parsed.claims.filter((claim) => claim.itemIds.includes(candidate.id));
    const claim = claims[0];
    if (
      claims.length !== 1 ||
      !claim ||
      claim.itemIds.length !== 1 ||
      !claim.action ||
      !claim.quantity ||
      !claim.unit
    ) {
      draft.problems.push({ code: 'unclear' });
      continue;
    }
    if (claim.action === 'hold' && !claim.condition && !claim.notBefore) {
      draft.problems.push({ code: 'hold' });
      continue;
    }
    draft.items.push({
      id: candidate.id,
      label: candidate.label,
      aliases: candidate.aliases,
      action: claim.action,
      quantity: claim.quantity,
      unit: claim.unit,
      notBefore: claim.notBefore ?? null,
      condition: claim.condition ?? null,
      owner: claim.owner ?? null,
      evidence: [claim.evidence],
      evidenceFields: [
        'object',
        'action',
        'quantity',
        'unit',
        ...(claim.notBefore !== undefined ? ['notBefore' as const] : []),
        ...(claim.condition !== undefined ? ['condition' as const] : []),
        ...(claim.owner !== undefined ? ['owner' as const] : []),
      ],
    });
  }
  return draft;
}

export function createReviewedHandover(
  draft: InstructionDraft,
  details: Omit<CreateHandoverInput, 'items' | 'language'>,
): HandoverState {
  const fresh = draftInstructions(draft.text, draft.language);
  const facts = (items: ItemInput[]) =>
    JSON.stringify(
      items.map((item) => ({
        id: item.id,
        label: item.label,
        aliases: item.aliases,
        quantity: item.quantity,
        unit: item.unit,
        action: item.action,
        notBefore: item.notBefore,
        condition: item.condition,
        owner: item.owner,
      })),
    );
  if (
    draft.problems.length ||
    fresh.problems.length ||
    !fresh.parsed ||
    !fresh.items.length ||
    facts(draft.items) !== facts(fresh.items)
  )
    throw new Error('Resolve the draft before creating this handover.');
  const state = createHandover({ ...details, language: fresh.language, items: fresh.items });
  return restoreHandover({
    ...state,
    utterances: [{ ...stampInterpretation(fresh.parsed), createdAt: state.createdAt }],
  });
}
