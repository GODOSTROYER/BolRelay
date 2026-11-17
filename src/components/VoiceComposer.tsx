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
  clearScope: () => void;
  onExample?: (kind: 'missed' | 'correct') => void;
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
  clearScope,
  onExample,
}: Props) {
  const [menu, setMenu] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const textArea = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceCapture(language, setText, (audio) => {
    setAudioUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return URL.createObjectURL(audio.blob);
    });
    onAudio(audio);
  });
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  useEffect(() => {
    if (scope) textArea.current?.focus();
  }, [scope]);
  return (
    <section className="panel composer" aria-labelledby="composer-heading">
      <div className="composer-heading">
        <h2 id="composer-heading">
          Say the plan.
          <br className="small-only" /> Check the understanding.
        </h2>
        <p>Capture each person’s words, then resolve what differs.</p>
      </div>
      <div className="role-tabs" role="tablist" aria-label="Participant">
        <button
          type="button"
          role="tab"
          aria-selected={role === 'outgoing'}
          disabled={voice.recording || voice.starting}
          onClick={() => setRole('outgoing')}
        >
          Outgoing instructions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={role === 'incoming'}
          disabled={voice.recording || voice.starting}
          onClick={() => setRole('incoming')}
        >
          Incoming read-back
        </button>
      </div>
      <div className="participant-row">
        <div className={`avatar ${role}`} aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <span>
          <strong>{name}</strong>
          <span className="muted"> · {role === 'outgoing' ? 'Outgoing' : 'Incoming'}</span>
        </span>
        <div className="language-control">
          <button
            className="button button-small"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menu}
            disabled={voice.recording || voice.starting}
            onClick={() => setMenu(!menu)}
          >
            {LANGUAGE_LABELS[language]}
            <ChevronDown size={15} />
          </button>
          {menu && (
            <>
              <button
                className="menu-dismiss"
                aria-label="Close language options"
                onClick={() => setMenu(false)}
              />
              <div className="language-menu" role="listbox" aria-label="Spoken language">
                {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={language === value}
                    onClick={() => {
                      setLanguage(value as Language);
                      setMenu(false);
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
          <span>
            Clarifying <strong>{scope}</strong>
          </span>
          <button type="button" onClick={clearScope} aria-label="Clear clarification target">
            <X size={14} />
          </button>
        </div>
      )}
      <label className="sr-only" htmlFor={`${role}-transcript`}>
        {role === 'incoming' ? 'Incoming read-back' : 'Outgoing instructions'}
      </label>
      <textarea
        ref={textArea}
        id={`${role}-transcript`}
        data-testid={`${role}-transcript`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          role === 'incoming'
            ? 'In your own words, what will you do with each parcel?'
            : 'Describe the actions, quantities, times, and anything that must stay on hold.'
        }
        rows={5}
        maxLength={4000}
        disabled={busy}
        spellCheck={false}
      />
      {voice.interim && (
        <p className="interim" aria-live="polite">
          {voice.interim}
        </p>
      )}
      {voice.error && (
        <p className="inline-error" role="status">
          {voice.error}
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
          className={`button ${voice.recording ? 'button-recording' : ''}`}
          disabled={busy || voice.starting || !voice.canRecord}
          onClick={() => (voice.recording ? voice.stop() : void voice.start())}
          aria-label={voice.recording ? 'Stop recording' : 'Record voice'}
        >
          {voice.starting ? (
            <LoaderCircle className="spin" size={18} />
          ) : voice.recording ? (
            <Square size={15} fill="currentColor" />
          ) : (
            <Mic size={19} />
          )}
          {voice.recording
            ? `Stop · ${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`
            : 'Record'}
        </button>
        <button
          type="button"
          className="button button-primary"
          data-testid={role === 'incoming' ? 'check-readback' : 'review-instructions'}
          disabled={busy || voice.starting || voice.recording || !text.trim()}
          onClick={onSubmit}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : null}
          {role === 'incoming' ? 'Check read-back' : 'Review instructions'}
          <ArrowRight size={17} />
        </button>
      </div>
      <p className="capture-note">
        Review the transcript before checking. Browser dictation may use an online service.
      </p>
      {!voice.canRecord && (
        <p className="capture-note">
          Recording is unavailable in this browser or connection. You can type your words above.
        </p>
      )}
      {onExample && role === 'incoming' && (
        <div className="examples">
          <span>Try the example:</span>
          <button type="button" onClick={() => onExample('missed')}>
            A missed hold
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => onExample('correct')}>
            A correct read-back
          </button>
        </div>
      )}
    </section>
  );
}
