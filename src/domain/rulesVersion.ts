import type { ParseIssue, ParsedClaim } from './types';

/**
 * Version of the interpretation rules (local parser and the local guards the
 * model adapter reuses). Bump this whenever `parser.ts` changes what a stored
 * transcript means, e.g. number words, negation, prerequisites or owners.
 *
 * Every newly stored interpretation is stamped with this value. Data without a
 * stamp is treated as version 0 (outdated). See `revalidation.ts` for how saved
 * approvals are rechecked when state is loaded, imported or restored.
 */
export const INTERPRETATION_RULES_VERSION = 5;

/** Stamp a newly produced interpretation with the rules that produced or validated it. */
export function stampInterpretation<T extends object>(parsed: T): T & { rulesVersion: number } {
  return { ...parsed, rulesVersion: INTERPRETATION_RULES_VERSION };
}

/**
 * Known local issue codes that the model adapter must never suppress. Since rules
 * version 3 this list is descriptive only: `isCriticalIssue` treats EVERY local
 * issue as critical unless its code is in `NON_BLOCKING_INTERPRETATION_ISSUE_CODES`,
 * so a newly added parser code can never be silently suppressed by a model claim.
 * Used by the guard in `server/model.ts` and offline to recheck stored model
 * interpretations, because a model cannot be re-run from saved state.
 */
export const CRITICAL_INTERPRETATION_ISSUE_CODES: readonly string[] = [
  'UNKNOWN_OBJECT_IDENTIFIER',
  'OUTSIDE_CLARIFICATION_SCOPE',
  'COMPETING_ACTIONS',
  'AMBIGUOUS_TIME',
  'UNSUPPORTED_BEFORE_TIME',
  'NEGATED_PREREQUISITE',
  'NEGATED_TIME',
  'UNHANDLED_NEGATION',
  'UNSUPPORTED_NEGATION',
  'COMPLETED_ACTION',
  'QUESTION_NOT_INTENT',
  'UNCERTAIN_INTENT',
  'UNSUPPORTED_DATE',
  'NEGATIVE_QUANTITY',
  'QUALIFIED_QUANTITY',
  'UNSUPPORTED_QUANTITY_EXPRESSION',
  'AMBIGUOUS_QUANTITY',
  'INVALID_QUANTITY',
  'UNSUPPORTED_EXCLUSION',
  'COMPOUND_CONDITION',
  'AMBIGUOUS_HOLD_CONDITION',
  'UNRECOGNISED_CONDITION',
  'UNRECOGNISED_ACTION',
  'UNRECOGNISED_OBJECT',
  'AMBIGUOUS_GROUP',
  'UNEXPLAINED_WORDING',
  'MULTIPLE_TIMES',
  'UNSUPPORTED_TIME_EXPRESSION',
  'UNSUPPORTED_DURATION',
  'UNANCHORED_QUANTITY',
  'AMBIGUOUS_UNIT',
  'INVERTED_GATE',
  'ADDRESSED_TO_OTHER',
];

/**
 * The only local issue codes a model claim may leave unmarked. Keep this list
 * small: an issue here carries no reading of the source that a claim could
 * contradict (an empty transcript can have no claim at all).
 */
export const NON_BLOCKING_INTERPRETATION_ISSUE_CODES: readonly string[] = ['EMPTY_TRANSCRIPT'];

/**
 * Every local issue is critical unless explicitly allowlisted. An unrecognised
 * object, condition or action means the local rules would report uncertainty, so a
 * model claim that leaves the field unmarked could turn that into agreement.
 */
export function isCriticalIssue(issue: ParseIssue): boolean {
  return !NON_BLOCKING_INTERPRETATION_ISSUE_CODES.includes(issue.code);
}

/** A current local critical issue that a stored claim did not mark as uncertain. */
export function suppressesCriticalIssue(claim: ParsedClaim, localIssues: ParseIssue[]): boolean {
  return localIssues.some(
    (issue) =>
      isCriticalIssue(issue) &&
      (issue.itemIds.length === 0 || issue.itemIds.some((id) => claim.itemIds.includes(id))) &&
      !claim.uncertainFields.includes(issue.field),
  );
}
