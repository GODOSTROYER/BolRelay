import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Check, LoaderCircle, Mic, Pause, Play, Square, Volume2 } from 'lucide-react';
import type { HandoverState, Language } from '../domain/types';
import { useTalkMode, type TalkDeps, type TalkEnd } from '../hooks/useTalkMode';
import { ui, type CopyKey } from '../lib/language';

/** Endings that close the full-screen loop and explain why beside the start button. */
const exitNotice: Partial<Record<TalkEnd, CopyKey>> = {
  microphone: 'talkNoMic',
  recognition: 'talkNoRecognition',
  failed: 'talkFailed',
  interrupted: 'talkInterrupted',
};

/**
 * Hands-free talk mode for the incoming worker: one large start button in the guided
 * view, then a full-screen speak → listen → check loop.
 */
export function TalkMode({
  language,
  contextKey,
  current,
  submit,
  confirm,
  blocked = false,
  disabled = false,
  hidden = false,
}: {
  language: Language;
  contextKey: string;
  current: () => HandoverState | undefined;
  submit: TalkDeps['submit'];
  confirm: TalkDeps['confirm'];
  blocked?: boolean;
  disabled?: boolean;
  /** Hides the start button (nothing is left to talk through); an open loop stays. */
  hidden?: boolean;
}) {
  const talk = useTalkMode({ language, contextKey, current, submit, confirm, blocked });
  const [notice, setNotice] = useState<CopyKey | null>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const exiting = talk.phase === 'ended' && talk.end !== 'complete' && talk.end !== 'escalated';
  const open = talk.phase !== 'idle' && !exiting;

  useEffect(() => {
    if (!exiting) return;
    setNotice(talk.end ? (exitNotice[talk.end] ?? null) : null);
    talk.reset();
    startButton.current?.focus();
  }, [exiting]);

  useEffect(() => {
    if (!open) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    title.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        talk.stop();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = prior;
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const close = () => {
    talk.reset();
    window.setTimeout(() => startButton.current?.focus(), 0);
  };
  const confirmStep = talk.step?.kind === 'confirm';
  const ended = talk.phase === 'ended';
  const words = talk.phase === 'listening' ? talk.live : talk.heard;
  const stateLabel: Record<string, CopyKey> = {
    speaking: 'talkSpeaking',
    listening: 'talkListening',
    checking: 'talkChecking',
    paused: 'talkPaused',
  };
  const orb =
    ended && talk.end === 'complete' ? (
      <Check size={52} strokeWidth={2.4} />
    ) : talk.phase === 'speaking' ? (
      <Volume2 size={52} />
    ) : talk.phase === 'listening' ? (
      talk.live ? (
        <AudioLines size={54} />
      ) : (
        <Mic size={54} />
      )
    ) : talk.phase === 'checking' ? (
      <LoaderCircle size={50} className="spin" />
    ) : talk.phase === 'paused' ? (
      <Pause size={50} />
    ) : (
      <Mic size={50} />
    );

  if (hidden && !open && !notice) return null;
  return (
    <div className="talk-entry">
      {!hidden && (
        <button
          ref={startButton}
          type="button"
          className="button button-primary talk-start"
          data-testid="talk-start"
          disabled={disabled || blocked || open}
          onClick={() => {
            setNotice(null);
            talk.start();
          }}
        >
          <Mic size={22} />
          <span>
            <strong>{ui(language, 'talkStart')}</strong>
            <small>{ui(language, 'talkStartHelp')}</small>
          </span>
        </button>
      )}
      {notice && (
        <p className="inline-error talk-notice" role="alert" data-testid="talk-notice">
          {ui(language, notice)}
        </p>
      )}
      {open &&
        createPortal(
          <div
            className={`talk-overlay is-${talk.phase} ${talk.end === 'complete' ? 'is-complete' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="talk-title"
            data-testid="talk-overlay"
            data-phase={talk.phase}
            lang={language}
          >
            <div className="talk-bar">
              <h2 id="talk-title" ref={title} tabIndex={-1}>
                {ui(language, 'talkTitle')}
              </h2>
              {!ended && (
                <button
                  type="button"
                  className="button talk-stop"
                  data-testid="talk-stop"
                  onClick={() => talk.stop()}
                >
                  <Square size={15} fill="currentColor" />
                  {ui(language, 'stop')}
                </button>
              )}
            </div>
            <div className="talk-body">
              <div className="talk-orb" aria-hidden="true">
                {orb}
              </div>
              {!ended && (
                <p className="talk-state" data-testid="talk-state">
                  {ui(language, stateLabel[talk.phase] ?? 'talkSpeaking')}
                </p>
              )}
              <p
                className="talk-prompt"
                aria-live="polite"
                aria-atomic="true"
                data-testid="talk-prompt"
              >
                {talk.phase === 'paused' ? ui(language, 'talkPaused') : talk.prompt}
              </p>
              {!talk.voiceOut && (
                <p className="talk-note" role="status" data-testid="talk-no-voice">
                  {ui(language, 'talkNoVoice')}
                </p>
              )}
              {words && !ended && (
                <figure className="talk-heard" data-testid="talk-heard">
                  <figcaption>{ui(language, 'talkHeard')}</figcaption>
                  <blockquote>{words}</blockquote>
                </figure>
              )}
              {confirmStep && !ended && talk.phase !== 'checking' && (
                <p className="talk-note">{ui(language, 'talkConfirmHint')}</p>
              )}
            </div>
            <div className="talk-actions">
              {ended ? (
                <button
                  type="button"
                  className="button button-primary"
                  data-testid="talk-close"
                  onClick={close}
                >
                  {ui(language, 'talkClose')}
                </button>
              ) : talk.phase === 'paused' ? (
                <button
                  type="button"
                  className="button button-primary"
                  data-testid="talk-continue"
                  onClick={() => talk.resume()}
                >
                  <Play size={20} />
                  {ui(language, 'talkContinue')}
                </button>
              ) : (
                <>
                  {confirmStep && (
                    <button
                      type="button"
                      className="button button-primary"
                      data-testid="talk-confirm"
                      disabled={talk.phase === 'checking'}
                      onClick={() => talk.confirmByTap()}
                    >
                      <Check size={20} />
                      {ui(language, 'confirmAll')}
                    </button>
                  )}
                  {talk.phase === 'listening' && (
                    <button
                      type="button"
                      className={`button ${confirmStep ? '' : 'button-primary'}`}
                      data-testid="talk-done-speaking"
                      disabled={!talk.recording}
                      onClick={() => talk.finishListening()}
                    >
                      <Square size={15} fill="currentColor" />
                      {ui(language, 'talkDoneSpeaking')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
