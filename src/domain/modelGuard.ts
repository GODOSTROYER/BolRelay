// Runtime imports keep their extension: `server/model.ts` loads this file directly.
import { canonicalCondition, canonicalUnit, normalizeText } from './parser.ts';
import type { ClaimField, Evidence, ParsedClaim } from './types';

type ValueField = Exclude<ClaimField, 'object'>;
type ClaimReading = Pick<ParsedClaim, 'itemIds' | 'uncertainFields'> &
  Partial<Pick<ParsedClaim, ValueField>>;

const VALUE_FIELDS: readonly ValueField[] = [
  'action',
  'quantity',
  'unit',
  'notBefore',
  'condition',
  'owner',
];

/**
 * The local reading of a model claim's own source quote bounds every field. Used
 * by the server when it accepts model output and offline by revalidation, because
 * a stored model reading cannot be re-run. Returns the first field that breaks
 * the rule, or undefined:
 * - 'object': a claimed item is not tied to this quote by the local rules
 *   (unless the object is marked uncertain);
 * - a value field: the local rules mark it uncertain, read a different value,
 *   or read nothing while the claim states one (unless marked uncertain).
 *
 * `localClaims` are the local claims of the quote that share an item with `claim`.
 */
export function modelClaimConflict(
  claim: ClaimReading,
  localClaims: readonly ClaimReading[],
): ClaimField | undefined {
  if (
    !claim.uncertainFields.includes('object') &&
    claim.itemIds.some((id) => !localClaims.some((candidate) => candidate.itemIds.includes(id)))
  )
    return 'object';
  const sameItems = (ids: string[]) =>
    ids.length === claim.itemIds.length && ids.every((id) => claim.itemIds.includes(id));
  const reading = (field: ValueField, candidate: ClaimReading) => {
    const value = candidate[field];
    if (value === undefined || value === null) return undefined;
    if (field === 'quantity') return sameItems(candidate.itemIds) ? String(value) : '(other items)';
    if (field === 'unit') return canonicalUnit(String(value));
    if (field === 'condition')
      return canonicalCondition(String(value)) || normalizeText(String(value));
    if (field === 'owner') return normalizeText(String(value));
    return String(value);
  };
  for (const field of VALUE_FIELDS) {
    if (claim.uncertainFields.includes(field)) continue;
    const stated = reading(field, claim);
    const heard = localClaims.map((candidate) => reading(field, candidate));
    if (
      localClaims.some((candidate) => candidate.uncertainFields.includes(field)) ||
      heard.some((value) => value !== undefined && value !== stated) ||
      (stated !== undefined && !heard.includes(stated))
    )
      return field;
  }
  return undefined;
}

/**
 * Every clause the local rules attribute to an item must be quoted by a model
 * claim or issue for that item; a provider may not park it in an issue for
 * another item. `heard` is the local parse of the whole `text`; `claims` and
 * `issues` are the model's, with evidence offsets into `text`.
 */
export function misattributesLocalStatement(
  text: string,
  heard: readonly { itemIds: string[]; evidence: Evidence }[],
  claims: readonly { itemIds: string[]; evidence: Evidence }[],
  issues: readonly { itemIds: string[]; evidence: Evidence }[],
  allowed: (itemId: string) => boolean,
): boolean {
  const lead = text.length - text.trimStart().length;
  const coverage = new Map<string, Uint8Array>();
  const coveredFor = (id: string) => {
    if (!coverage.has(id)) {
      const marks = new Uint8Array(text.length);
      for (const part of [
        ...claims.filter((claim) => claim.itemIds.includes(id)),
        ...issues.filter((issue) => issue.itemIds.length === 0 || issue.itemIds.includes(id)),
      ])
        marks.fill(1, part.evidence.start, part.evidence.end);
      coverage.set(id, marks);
    }
    return coverage.get(id)!;
  };
  for (const statement of heard)
    for (const id of statement.itemIds.filter(allowed)) {
      const marks = coveredFor(id);
      for (let at = statement.evidence.start; at < statement.evidence.end; at++)
        if (
          /[\p{L}\p{N}]/u.test(statement.evidence.text[at - statement.evidence.start]!) &&
          !marks[at + lead]
        )
          return true;
    }
  return false;
}
