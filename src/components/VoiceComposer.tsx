import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  LoaderCircle,
  Mic,
  Square,
  X,
  Volume2,
} from 'lucide-react';
import type { Language, ParticipantRole } from '../domain/types';
import { useVoiceCapture, type CapturedAudio } from '../hooks/useVoiceCapture';
import { ui } from '../lib/language';
import { stopSpeechOutput } from '../hooks/useSpeechOutput';

export const LANGUAGE_LABELS: Record<Language, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'mr-IN': 'मराठी',
};

interface Props {
  role: ParticipantRole;
  setRole: (role: ParticipantRole) => void;
  text: string;
  setText: (text: string) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  name: string;
  busy: boolean;
  onSubmit: () => void;
  onAudio: (audio: CapturedAudio | null) => void;
  scope?: string;
  /** The question being answered, repeated beside the field while it is on screen. */
  scopeQuestion?: string;
  clearScope: () => void;
  onExample?: (kind: 'missed' | 'correct') => void;
  contextKey?: string;
}

export function VoiceComposer({
  role,
  setRole,
  text,
  setText,
  language,
  setLanguage,
  name,
  busy,
  onSubmit,
  onAudio,
  scope,
  scopeQuestion,
  clearScope,
  onExample,
  contextKey = '',
}: Props) {
  const [menu, setMenu] = useState(false);
  const [languageFocus, setLanguageFocus] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const textArea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // When an on-screen keyboard opens over the focused field, scroll it (and the
    // question beside it) back above the keyboard and the sticky actions.
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keepVisible = () =>
      window.requestAnimationFrame(() => {
        const inset = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset'),
        );
        if (inset > 0 && document.activeElement === textArea.current)
          textArea.current?.scrollIntoView({ block: 'nearest' });
      });
    viewport.addEventListener('resize', keepVisible);
    return () => viewport.removeEventListener('resize', keepVisible);
  }, []);
  const languageButton = useRef<HTMLButtonElement>(null);
  const languageOptions = useRef<(HTMLButtonElement | null)[]>([]);
  const languageValues = Object.keys(LANGUAGE_LABELS) as Language[];
  const voice = useVoiceCapture(
    language,
    setText,
    (audio) => {
      setAudioUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return URL.createObjectURL(audio.blob);
      });
      onAudio(audio);
    },
    `${contextKey}:${role}:${scope ?? 'full'}`,
  );
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  useEffect(() => {
    if (scope) textArea.current?.focus();
  }, [scope]);
  useEffect(() => {
    setAudioUrl('');
    onAudio(null);
  }, [contextKey, role, scope, language, onAudio]);
  useEffect(() => {
    if (menu) languageOptions.current[languageFocus]?.focus();
  }, [menu, languageFocus]);
  const openLanguages = () => {
    setLanguageFocus(languageValues.indexOf(language));
    setMenu(true);
  };
  const closeLanguages = () => {
    setMenu(false);
    languageButton.current?.focus();
  };
  return (
    <section className="panel composer" aria-labelledby="composer-heading">
      <div className="composer-heading">
        <h2 id="composer-heading">{ui(language, 'heading')}</h2>
        <p>{ui(language, 'intro')}</p>
      </div>
      <div className="role-tabs" role="tablist" aria-label="Participant">
        <button
          type="button"
          role="tab"
          aria-selected={role === 'outgoing'}
          disabled={voice.busy || busy}
          onClick={() => setRole('outgoing')}
        >
          {ui(language, 'outgoing')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={role === 'incoming'}
          disabled={voice.busy || busy}
          onClick={() => setRole('incoming')}
        >
          {ui(language, 'incoming')}
        </button>
      </div>
      <div className="participant-row">
        <div className={`avatar ${role}`} aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <span>
          <strong>{name}</strong>
          <span className="muted">
            {' '}
            · {ui(language, role === 'outgoing' ? 'sender' : 'receiver')}
          </span>
        </span>
        <div className="language-control">
          <button
            ref={languageButton}
            className="button button-small"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menu}
            aria-controls={menu ? 'spoken-language-menu' : undefined}
            disabled={voice.busy || busy}
            onClick={() => (menu ? closeLanguages() : openLanguages())}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                openLanguages();
              }
            }}
          >
            {LANGUAGE_LABELS[language]}
            <ChevronDown size={15} />
          </button>
          {menu && (
            <>
              <button
                className="menu-dismiss"
                aria-label="Close language options"
                tabIndex={-1}
                onClick={closeLanguages}
              />
              <div
                className="language-menu"
                id="spoken-language-menu"
                role="listbox"
                aria-label="Spoken language"
              >
                {Object.entries(LANGUAGE_LABELS).map(([value, label], index) => (
                  <button
                    ref={(node) => {
                      languageOptions.current[index] = node;
                    }}
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={language === value}
                    tabIndex={languageFocus === index ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        setLanguageFocus(
                          (current) =>
                            (current + direction + languageValues.length) % languageValues.length,
                        );
                      } else if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        setLanguageFocus(event.key === 'Home' ? 0 : languageValues.length - 1);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        closeLanguages();
                      } else if (event.key === 'Tab') {
                        window.setTimeout(() => setMenu(false), 0);
                      }
                    }}
                    onClick={() => {
                      setLanguage(value as Language);
                      setAudioUrl('');
                      onAudio(null);
                      closeLanguages();
                    }}
                  >
                    {label}
                    {language === value && <Check size={15} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {scope && (
        <div className="scope-note">
          {scopeQuestion ? (
            <span id={`${role}-scope-question`} data-testid="scope-question">
              {scopeQuestion}
            </span>
          ) : (
            <span>
              {ui(language, 'clarifyTitle')}: <strong>{scope}</strong>
            </span>
          )}
          <button
            type="button"
            disabled={voice.busy || busy}
            onClick={clearScope}
            aria-label="Clear clarification target"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <label className="sr-only" htmlFor={`${role}-transcript`}>
        {ui(language, role === 'incoming' ? 'incoming' : 'outgoing')}
      </label>
      <textarea
        ref={textArea}
        id={`${role}-transcript`}
        data-testid={`${role}-transcript`}
        value={text}
        lang={language}
        aria-describedby={scope && scopeQuestion ? `${role}-scope-question` : undefined}
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
        onChange={(event) => {
          setText(event.target.value);
          setAudioUrl('');
          onAudio(null);
        }}
        placeholder={role === 'incoming' ? ui(language, 'inputHint') : ui(language, 'outgoingHint')}
        rows={4}
        maxLength={4000}
        disabled={busy || voice.busy}
        spellCheck={false}
      />
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
      {voice.finalizing && (
        <p className="capture-note" data-testid="capture-status" role="status">
          {ui(language, 'finishing')}
        </p>
      )}
      {audioUrl && (
        <div className="recording-playback">
          <Volume2 size={15} />
          <audio src={audioUrl} controls preload="metadata" aria-label="Latest recording" />
          <button
            type="button"
            className="icon-button"
            aria-label="Discard recording"
            onClick={() => {
              setAudioUrl('');
              onAudio(null);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="composer-actions">
        <button
          type="button"
          className={`button button-primary ${voice.recording ? 'button-recording' : ''}`}
          data-testid="record-voice"
          disabled={busy || voice.starting || voice.finalizing || !voice.canRecord}
          onClick={() => {
            if (voice.recording) voice.stop();
            else {
              stopSpeechOutput();
              setAudioUrl('');
              onAudio(null);
              void voice.start();
            }
          }}
          aria-label={
            language === 'en-IN'
              ? voice.recording
                ? 'Stop recording'
                : 'Record voice'
              : ui(language, voice.recording ? 'stop' : 'record')
          }
        >
          {voice.starting || voice.finalizing ? (
            <LoaderCircle className="spin" size={18} />
          ) : voice.recording ? (
            <Square size={15} fill="currentColor" />
          ) : (
            <Mic size={19} />
          )}
          {voice.recording
            ? `${ui(language, 'stop')} · ${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`
            : ui(language, voice.finalizing ? 'finishing' : 'record')}
        </button>
        <button
          type="button"
          className="button"
          data-testid={role === 'incoming' ? 'check-readback' : 'review-instructions'}
          disabled={busy || voice.busy || !text.trim()}
          onClick={onSubmit}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : null}
          {ui(language, role === 'incoming' ? 'check' : 'review')}
          <ArrowRight size={17} />
        </button>
      </div>
      <p className="capture-note">{ui(language, 'captureNote')}</p>
      {!voice.canRecord && <p className="capture-note">{ui(language, 'unavailable')}</p>}
      {onExample && role === 'incoming' && (
        <div className="examples">
          <span>Try the example:</span>
          <button type="button" disabled={voice.busy || busy} onClick={() => onExample('missed')}>
            A missed hold
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" disabled={voice.busy || busy} onClick={() => onExample('correct')}>
            A correct read-back
          </button>
        </div>
      )}
    </section>
  );
}
