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
export const INTERPRETATION_RULES_VERSION = 2;

/** Stamp a newly produced interpretation with the rules that produced or validated it. */
export function stampInterpretation<T extends object>(parsed: T): T & { rulesVersion: number } {
  return { ...parsed, rulesVersion: INTERPRETATION_RULES_VERSION };
}

/**
 * Local issue codes that the model adapter must never suppress. This is the
 * single list used by the critical guard in `server/model.ts`. Used offline to recheck stored model
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
];

export function isCriticalIssue(issue: ParseIssue): boolean {
  return (
    CRITICAL_INTERPRETATION_ISSUE_CODES.includes(issue.code) ||
    (issue.code === 'UNRECOGNISED_OBJECT' &&
      /\b(?:send|dispatch|release|ship|hold|pack|collect)\b/iu.test(issue.evidence.text))
  );
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
