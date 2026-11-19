import {
  clarificationAttempts,
  clarificationField,
  compareHandover,
  needsFullRestatement,
} from './engine';
import { normalizeText } from './parser';
import type { ClaimField, HandoverState, Language } from './types';
import { currentQuestion, describeInstruction, ui } from '../lib/language';

/**
 * Talk mode: what the app says next in the hands-free loop, decided from the handover
 * alone. It never decides anything the guided view would not: the same current item, the
 * same question wording, and confirmation only through the existing confirm path.
 */

/** After this many unresolved answers to the same question, stop asking and hand back. */
export const CLARIFICATION_ATTEMPT_LIMIT = 3;

export type TalkStepKind = 'readback' | 'clarify' | 'restate' | 'confirm' | 'done' | 'escalate';

export interface TalkStep {
  kind: TalkStepKind;
  /** The item a clarification, restatement or escalation is about. */
  itemId?: string;
  /** The single detail a clarification asks for. */
  field?: ClaimField;
  /** Spoken and shown. Never contains an expected value before the worker stated it. */
  prompt: string;
  /**
   * Identifies the exact handover situation the prompt was built for. A spoken
   * confirmation counts only while the key it was asked under is still current.
   */
  key: string;
}

/** The next talk-mode step for the incoming worker of this handover. */
export function talkStep(state: HandoverState, language: Language): TalkStep {
  const comparisons = compareHandover(state);
  const revisions = state.items.map((item) => `${item.id}@${item.revision}`).join(',');
  const confirmed = comparisons
    .filter((result) => result.confirmed)
    .map((result) => result.itemId)
    .join(',');
  const key = (kind: TalkStepKind, itemId = '') =>
    [kind, itemId, state.id, revisions, state.utterances.length, confirmed].join('|');
  if (comparisons.length > 0 && comparisons.every((result) => result.confirmed))
    return { kind: 'done', prompt: ui(language, 'completeTitle'), key: key('done') };
  if (!state.utterances.some((utterance) => utterance.role === 'incoming'))
    return { kind: 'readback', prompt: ui(language, 'talkReadback'), key: key('readback') };
  const open = comparisons.find((result) => result.stale || result.status !== 'agreement');
  if (open) {
    const item = state.items.find((entry) => entry.id === open.itemId)!;
    const field = clarificationField(open);
    const { attempts } = field ? clarificationAttempts(state, item.id) : { attempts: 0 };
    if (attempts >= CLARIFICATION_ATTEMPT_LIMIT)
      return {
        kind: 'escalate',
        itemId: item.id,
        ...(field ? { field } : {}),
        prompt: `${item.label}. ${ui(language, 'talkAskSender')}`,
        key: key('escalate', item.id),
      };
    // Exactly the guided view's question, so the spoken prompt reveals no more than it.
    const prompt = currentQuestion(state, item, open, language);
    const restate =
      !field || open.stale || (field !== 'object' && needsFullRestatement(state, item.id));
    return {
      kind: restate ? 'restate' : 'clarify',
      itemId: item.id,
      ...(field ? { field } : {}),
      prompt,
      key: key(restate ? 'restate' : 'clarify', item.id),
    };
  }
  // Every item matches what the worker said: read their plan back and ask for an
  // explicit spoken confirmation.
  const plan = state.items.map((item) => describeInstruction(item, language)).join(' ');
  return {
    kind: 'confirm',
    prompt: `${ui(language, 'talkConfirmIntro')} ${plan} ${ui(language, 'talkConfirmAsk')}`,
    key: key('confirm'),
  };
}

/**
 * The only utterances that confirm: an explicit confirm word, alone. A bare "yes",
 * "हाँ", "हो" or "ok" is deliberately absent.
 */
export const CONFIRM_PHRASES: Record<Language, readonly string[]> = {
  'en-IN': ['confirm', 'confirmed', 'i confirm', 'yes confirm', 'yes confirmed'],
  'hi-IN': ['पक्का', 'कन्फर्म', 'कंफर्म', 'हाँ पक्का', 'हां पक्का', 'हाँ कन्फर्म', 'हां कन्फर्म', 'confirm'],
  'mr-IN': ['नक्की', 'कन्फर्म', 'कंफर्म', 'हो नक्की', 'होय नक्की', 'हो कन्फर्म', 'confirm'],
};

const phraseKey = (text: string) =>
  normalizeText(text)
    .replace(/[\s.,!?;:।'"“”’‘-]+/gu, ' ')
    .trim();

/** Whether the whole utterance is one of this language's explicit confirm phrases. */
export function isConfirmPhrase(text: string, language: Language): boolean {
  // "Confirm?" asks; it does not confirm.
  if (/[?？]/u.test(text)) return false;
  const said = phraseKey(text);
  return !!said && CONFIRM_PHRASES[language].some((phrase) => phraseKey(phrase) === said);
}

/**
 * How talk mode treats what it heard: a confirmation only for a confirm phrase said in
 * answer to the confirm step; anything else is an ordinary read-back or answer.
 */
export function talkReply(
  step: Pick<TalkStep, 'kind'>,
  text: string,
  language: Language,
): 'confirm' | 'answer' {
  return step.kind === 'confirm' && isConfirmPhrase(text, language) ? 'confirm' : 'answer';
}

/** The item a heard answer is scoped to: none for a full read-back. */
export function talkScope(step: TalkStep): string | null {
  return step.kind === 'clarify' || step.kind === 'restate' ? (step.itemId ?? null) : null;
}
