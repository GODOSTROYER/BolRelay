import { ArrowRight, Check, CircleHelp } from 'lucide-react';
import { clarificationAttempts, clarificationField } from '../domain/engine';
import type { HandoverState, ItemComparison, Language } from '../domain/types';
import { clarificationQuestion, describeInstruction, retryQuestion, ui } from '../lib/language';
import { SpeakButton } from './SpeakButton';

/** After this many unresolved answers to the same question, offer a way out instead of looping. */
const CLARIFICATION_ATTEMPT_LIMIT = 3;

export function RecipientGuide({
  state,
  comparisons,
  language,
  scope,
  onClarify,
  onConfirm,
  onReview,
  busy = false,
}: {
  state: HandoverState;
  comparisons: ItemComparison[];
  language: Language;
  scope: string | null;
  onClarify: (id: string) => void;
  onConfirm: (id: string) => void;
  onReview?: () => void;
  busy?: boolean;
}) {
  const heard = state.utterances.some((utterance) => utterance.role === 'incoming');
  const current =
    comparisons.find((result) => result.itemId === scope) ??
    comparisons.find((result) => result.stale || result.status !== 'agreement') ??
    comparisons.find((result) => !result.confirmed);
  const item = state.items.find((entry) => entry.id === current?.itemId);
  const complete = comparisons.length > 0 && comparisons.every((result) => result.confirmed);
  const field = current && clarificationField(current);
  // A repeated question is reworded; a bare "yes" is told it cannot answer it.
  const { attempts, bareReply } =
    item && field ? clarificationAttempts(state, item.id) : { attempts: 0, bareReply: false };
  const question =
    item && current
      ? field && attempts > 0
        ? retryQuestion(item, field, bareReply, language)
        : clarificationQuestion(item, current, language)
      : ui(language, 'readyToSpeak');
  const contextKey = `${state.id}:${language}:${item?.id ?? 'full'}:${item?.revision ?? 0}:${attempts}`;
  const change =
    item && current?.stale
      ? [...state.events]
          .reverse()
          .find((event) => event.type === 'item-revised' && event.itemIds.includes(item.id))
      : undefined;
  const before = change?.before?.find((previous) => previous.id === item?.id);
  return (
    <section
      className={`recipient-guide ${complete ? 'is-complete' : ''}`}
      aria-label={ui(language, 'workerView')}
      data-testid="recipient-guide"
    >
      <div className="guide-heading">
        {complete ? <Check size={23} /> : <CircleHelp size={23} />}
        <h2>
          {ui(
            language,
            complete
              ? 'completeTitle'
              : !heard
                ? 'readyToSpeak'
                : current?.status === 'agreement' && !current.stale
                  ? 'matchedTitle'
                  : 'clarifyTitle',
          )}
        </h2>
      </div>
      <SpeakButton
        language={language}
        text={state.items.map((entry) => describeInstruction(entry, language)).join('\n')}
        contextKey={`${state.id}:${state.updatedAt}:plan`}
        label={ui(language, 'listenPlan')}
        testId="listen-current-plan"
      />
      <details
        className="guide-instructions"
        data-testid="read-current-instructions"
        key={`${state.id}:${language}`}
      >
        <summary>{ui(language, 'readPlan')}</summary>
        <ul>
          {state.items.map((entry) => (
            <li key={entry.id}>{describeInstruction(entry, language)}</li>
          ))}
        </ul>
      </details>
      {!complete && heard && item && current && (
        <div className="guide-current">
          <strong>{item.label}</strong>
          {change && before && (
            <div className="change-receipt" data-testid="change-receipt">
              <span>
                {ui(language, 'updated')} · {state.outgoingName}
              </span>
              <p>
                <s>{describeInstruction(before, language)}</s>
              </p>
              <p>{describeInstruction(item, language)}</p>
            </div>
          )}
          {current.status === 'agreement' && !current.stale ? (
            <>
              <p>{describeInstruction(item, language)}</p>
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                data-testid="guide-confirm"
                onClick={() => onConfirm(item.id)}
              >
                <Check size={16} />
                {ui(language, 'confirm')} · {item.label}
              </button>
            </>
          ) : (
            <>
              <p className="guide-question" data-attempts={attempts}>
                {question}
              </p>
              {attempts >= CLARIFICATION_ATTEMPT_LIMIT && (
                <p className="field-help" role="status" data-testid="clarification-escape">
                  {ui(language, 'stillUnclear')}
                </p>
              )}
              <div className="guide-actions">
                <SpeakButton
                  text={question}
                  language={language}
                  contextKey={contextKey}
                  label={ui(language, 'listenQuestion')}
                  testId="listen-clarification"
                />
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  data-testid="guide-clarify"
                  onClick={() => onClarify(item.id)}
                >
                  {ui(language, 'clarify')}
                  <ArrowRight size={16} />
                </button>
                {attempts >= CLARIFICATION_ATTEMPT_LIMIT && onReview && (
                  <button
                    className="button button-small"
                    type="button"
                    data-testid="guide-review-board"
                    onClick={onReview}
                  >
                    {ui(language, 'reviewOnBoard')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <p className="field-help">
        {ui(language, complete ? 'completeHelp' : scope ? 'targetedCheck' : 'fullCheck')}
      </p>
      {complete && <p className="field-help">{ui(language, 'meaning')}</p>}
    </section>
  );
}
