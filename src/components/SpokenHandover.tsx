import { useEffect, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, Mic, Square } from 'lucide-react';
import { createReviewedHandover, draftInstructions, type InstructionDraft } from '../domain/draft';
import type { HandoverItem, HandoverState, Language } from '../domain/types';
import { useVoiceCapture, type CapturedAudio } from '../hooks/useVoiceCapture';
import { stopSpeechOutput } from '../hooks/useSpeechOutput';
import { describeInstruction, ui } from '../lib/language';
import { Modal } from './Modal';
import { SpeakButton } from './SpeakButton';
import { LANGUAGE_LABELS } from './VoiceComposer';

/** Typed text kept by the app while the dialog is closed (for example across a reload). */
export interface SpokenHandoverDraft {
  text: string;
  title: string;
  outgoingName: string;
  incomingName: string;
}

export function SpokenHandover({
  onClose,
  onManual,
  onCreate,
  initialLanguage = 'en-IN',
  initialDraft,
  onDraftChange,
}: {
  onClose: () => void;
  onManual: () => void;
  onCreate: (state: HandoverState, audio: CapturedAudio | null) => Promise<void>;
  initialLanguage?: Language;
  initialDraft?: SpokenHandoverDraft;
  onDraftChange?: (draft: SpokenHandoverDraft) => void;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [text, setText] = useState(initialDraft?.text ?? '');
  const [audio, setAudio] = useState<CapturedAudio | null>(null);
  const [draft, setDraft] = useState<InstructionDraft | null>(null);
  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const [outgoingName, setOutgoingName] = useState(initialDraft?.outgoingName ?? '');
  const [incomingName, setIncomingName] = useState(initialDraft?.incomingName ?? '');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const voice = useVoiceCapture(
    language,
    setText,
    setAudio,
    `create:${language}:${draft ? 'review' : 'capture'}`,
  );
  useEffect(() => {
    onDraftChange?.({ text, title, outgoingName, incomingName });
  }, [onDraftChange, text, title, outgoingName, incomingName]);
  const valid = !!draft && !draft.problems.length && draft.items.length > 0;
  const proposed =
    draft?.items
      .map((item) =>
        describeInstruction(
          {
            ...item,
            revision: 1,
            aliases: item.aliases ?? [],
            evidence: item.evidence ?? [],
          } as HandoverItem,
          language,
        ),
      )
      .join('\n') ?? '';
  return (
    <Modal
      title={ui(language, valid ? 'draftReview' : 'spokenDraft')}
      subtitle={ui(language, 'draftHelp')}
      onClose={onClose}
      wide
    >
      <div className="draft-languages" role="group" aria-label="Handover language">
        {(Object.keys(LANGUAGE_LABELS) as Language[]).map((value) => (
          <button
            type="button"
            key={value}
            className={`button button-small ${value === language ? 'language-selected' : ''}`}
            aria-pressed={value === language}
            disabled={voice.busy || busy}
            onClick={() => {
              setLanguage(value);
              setDraft(null);
              setReviewed(false);
              setAudio(null);
            }}
          >
            {LANGUAGE_LABELS[value]}
          </button>
        ))}
      </div>
      {!valid ? (
        <>
          <label className="field" htmlFor="new-spoken-instructions">
            {ui(language, 'outgoing')}
            <textarea
              id="new-spoken-instructions"
              data-testid="new-spoken-instructions"
              lang={language}
              value={text}
              disabled={voice.busy || busy}
              rows={5}
              maxLength={4000}
              onChange={(event) => {
                setText(event.target.value);
                setDraft(null);
                setAudio(null);
              }}
              placeholder={ui(language, 'draftPlaceholder')}
            />
          </label>
          {voice.interim && (
            <p className="interim" aria-live="polite">
              {voice.interim}
            </p>
          )}
          {voice.error && (
            <p className="inline-error" role="status">
              {language === 'en-IN' ? voice.error : ui(language, 'unavailable')}
            </p>
          )}
          {voice.finalizing && <p role="status">{ui(language, 'finishing')}</p>}
          {draft?.problems.length ? (
            <p className="inline-error" role="alert">
              {ui(language, 'draftProblem')}
            </p>
          ) : null}
          <div className="composer-actions">
            <button
              type="button"
              className={`button button-primary ${voice.recording ? 'button-recording' : ''}`}
              disabled={!voice.canRecord || voice.starting || voice.finalizing || busy}
              aria-label={voice.recording ? 'Stop new recording' : 'Record new instructions'}
              onClick={() => {
                if (voice.recording) voice.stop();
                else {
                  stopSpeechOutput();
                  setAudio(null);
                  setDraft(null);
                  setReviewed(false);
                  void voice.start();
                }
              }}
            >
              {voice.starting || voice.finalizing ? (
                <LoaderCircle className="spin" size={18} />
              ) : voice.recording ? (
                <Square size={17} />
              ) : (
                <Mic size={20} />
              )}
              {ui(language, voice.finalizing ? 'finishing' : voice.recording ? 'stop' : 'record')}
            </button>
            <button
              type="button"
              className="button"
              data-testid="review-new-instructions"
              disabled={!text.trim() || voice.busy || busy}
              onClick={() => {
                voice.cancel();
                setReviewed(false);
                setDraft(draftInstructions(text, language));
              }}
            >
              {ui(language, 'review')} <ArrowRight size={17} />
            </button>
          </div>
          <p className="capture-note">
            {ui(language, voice.canRecord ? 'captureNote' : 'unavailable')}
          </p>
        </>
      ) : (
        <>
          <div className="spoken-draft-items" data-testid="spoken-draft-preview">
            {draft.items.map((item) => (
              <div key={item.id}>
                <strong>{item.label}</strong>
                <p>{describeInstruction({ ...item, revision: 1 } as HandoverItem, language)}</p>
              </div>
            ))}
          </div>
          <SpeakButton
            text={proposed}
            language={language}
            contextKey={draft.parsed!.utteranceId}
            label={ui(language, 'listenPlan')}
            testId="listen-new-plan"
          />
          <p className="field-help">{ui(language, 'draftNames')}</p>
          <label className="review-attestation">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              data-testid="attest-new-instructions"
            />
            {ui(language, 'draftAttest')}
          </label>
          <details className="draft-metadata">
            <summary>{ui(language, 'optionalNames')}</summary>
            <label className="field">
              {ui(language, 'title')}
              <input
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                {ui(language, 'sender')}
                <input
                  value={outgoingName}
                  maxLength={60}
                  onChange={(event) => setOutgoingName(event.target.value)}
                />
              </label>
              <label className="field">
                {ui(language, 'receiver')}
                <input
                  value={incomingName}
                  maxLength={60}
                  onChange={(event) => setIncomingName(event.target.value)}
                />
              </label>
            </div>
          </details>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setReviewed(false);
              }}
            >
              {ui(language, 'editWords')}
            </button>
            <button
              type="button"
              className="button button-primary"
              data-testid="create-spoken-handover"
              disabled={!reviewed || busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const state = createReviewedHandover(draft, {
                    title:
                      title.trim() ||
                      draft.items
                        .map((item) => item.label)
                        .join(' · ')
                        .slice(0, 120),
                    outgoingName: outgoingName.trim() || ui(language, 'sender'),
                    incomingName: incomingName.trim() || ui(language, 'receiver'),
                  });
                  await onCreate(state, audio);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : ui(language, 'draftProblem'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Check size={17} />
              {ui(language, 'create')}
            </button>
          </div>
        </>
      )}
      {!valid && (
        <div className="modal-actions">
          <button
            type="button"
            className="text-button"
            disabled={voice.busy || busy}
            onClick={onManual}
          >
            {ui(language, 'manual')}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {ui(language, 'cancel')}
          </button>
        </div>
      )}
    </Modal>
  );
}
