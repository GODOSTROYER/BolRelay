import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, CircleHelp } from 'lucide-react';
import { clarificationAttempts, clarificationField } from '../domain/engine';
import { CLARIFICATION_ATTEMPT_LIMIT } from '../domain/talk';
import type { HandoverState, ItemComparison, Language } from '../domain/types';
import { currentQuestion, describeInstruction, ui } from '../lib/language';
import { SpeakButton } from './SpeakButton';

const scrollMotion = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
// Space to leave above a scrolled-to step, below a notification pinned to the top.
const topInset = () => {
  const toast = document.querySelector('.toast')?.getBoundingClientRect();
  return toast && toast.top < window.innerHeight / 2 ? toast.bottom + 8 : 12;
};

export function RecipientGuide({
  state,
  comparisons,
  language,
  scope,
  onClarify,
  onConfirm,
  onReview,
  busy = false,
  talk,
}: {
  state: HandoverState;
  comparisons: ItemComparison[];
  language: Language;
  scope: string | null;
  onClarify: (id: string) => void;
  onConfirm: (id: string) => void;
  onReview?: () => void;
  busy?: boolean;
  /** The hands-free talk mode entry, shown under the heading. */
  talk?: ReactNode;
}) {
  const heard = state.utterances.some((utterance) => utterance.role === 'incoming');
  const current =
    comparisons.find((result) => result.itemId === scope) ??
    comparisons.find((result) => result.stale || result.status !== 'agreement') ??
    comparisons.find((result) => !result.confirmed);
  const item = state.items.find((entry) => entry.id === current?.itemId);
  const complete = comparisons.length > 0 && comparisons.every((result) => result.confirmed);
  const field = current && clarificationField(current);
  // A repeated question is reworded; a bare "yes" is told it cannot answer it; wording a
  // short answer cannot resolve asks for the whole item again.
  const { attempts } = item && field ? clarificationAttempts(state, item.id) : { attempts: 0 };
  const question =
    item && current
      ? currentQuestion(state, item, current, language)
      : ui(language, 'readyToSpeak');
  const contextKey = `${state.id}:${language}:${item?.id ?? 'full'}:${item?.revision ?? 0}:${attempts}`;
  const change =
    item && current?.stale
      ? [...state.events]
          .reverse()
          .find((event) => event.type === 'item-revised' && event.itemIds.includes(item.id))
      : undefined;
  const before = change?.before?.find((previous) => previous.id === item?.id);
  const answering = !!scope && scope === item?.id;
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  // After a read-back, confirmation or instruction change, bring the new step
  // into view and move focus to its heading instead of leaving the worker at
  // the bottom of the page beside the composer they just used.
  const stepKey = [
    complete,
    heard,
    current?.itemId,
    current?.status,
    current?.stale,
    current?.confirmed,
    item?.revision,
    state.utterances.length,
  ].join(':');
  const previousStep = useRef({ id: state.id, key: stepKey });
  // The heading text often stays the same ("The stated actions match the plan"), so
  // a polite status also says what was confirmed and which item and question follow.
  const confirmedIds = comparisons.filter((result) => result.confirmed).map((r) => r.itemId);
  const previousConfirmed = useRef(confirmedIds);
  const [announcement, setAnnouncement] = useState('');
  const prompt =
    complete || !heard || !item || !current
      ? ''
      : current.status === 'agreement' && !current.stale
        ? `${item.label}. ${ui(language, 'matchedTitle')}. ${describeInstruction(item, language)}`
        : question;
  useEffect(() => {
    const previous = previousStep.current;
    previousStep.current = { id: state.id, key: stepKey };
    const newlyConfirmed = confirmedIds.filter((id) => !previousConfirmed.current.includes(id));
    previousConfirmed.current = confirmedIds;
    if (previous.id !== state.id || previous.key === stepKey) return;
    const confirmedLabels = newlyConfirmed
      .map((id) => state.items.find((entry) => entry.id === id)?.label)
      .filter(Boolean)
      .join(', ');
    const message = [
      confirmedLabels && `${ui(language, 'confirmed')}: ${confirmedLabels}.`,
      complete
        ? ui(language, 'completeTitle')
        : prompt && (confirmedLabels ? `${ui(language, 'nextItem')}: ${prompt}` : prompt),
    ]
      .filter(Boolean)
      .join(' ');
    // A repeated, identical question is still announced again.
    setAnnouncement((before) => (before === message ? `${message}\u00a0` : message));
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top;
    const inset = topInset();
    if (top < inset || top > window.innerHeight / 3)
      window.scrollBy({ top: top - inset, behavior: scrollMotion() });
    headingRef.current?.focus({ preventScroll: true });
  }, [state.id, stepKey]);
  // When the view opens on an open item, show the whole current card. When the
  // worker starts answering a clarification, keep its question above the field.
  const shown = useRef(false);
  useEffect(() => {
    const opening = !shown.current;
    if (!opening && !answering) return;
    const timer = window.setTimeout(() => {
      shown.current = true;
      const anchor = currentRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const field = opening
        ? undefined
        : document.getElementById('incoming-transcript')?.getBoundingClientRect();
      const bar = field
        ? (document.querySelector('.composer-actions')?.getBoundingClientRect().height ?? 0)
        : 0;
      const inset = topInset();
      const room = window.innerHeight - bar - 12;
      const bottom = field?.bottom ?? anchor.bottom;
      if (opening && anchor.top >= inset && bottom <= room) return;
      const shift = bottom - anchor.top + inset <= room ? anchor.top - inset : bottom - room;
      if (Math.abs(shift) > 4) window.scrollBy({ top: shift, behavior: scrollMotion() });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [answering, item?.id]);
  return (
    <section
      ref={sectionRef}
      className={`recipient-guide ${complete ? 'is-complete' : ''}`}
      aria-label={ui(language, 'workerView')}
      data-testid="recipient-guide"
    >
      <div className="guide-heading">
        {complete ? <Check size={23} /> : <CircleHelp size={23} />}
        <h2 ref={headingRef} tabIndex={-1}>
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
      {talk}
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
        <div className="guide-current" ref={currentRef}>
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
      <p className="sr-only" role="status" aria-atomic="true" data-testid="guide-announcement">
        {announcement}
      </p>
    </section>
  );
}
