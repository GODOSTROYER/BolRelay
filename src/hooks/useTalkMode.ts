import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandoverState, Language } from '../domain/types';
import { talkReply, talkScope, talkStep, type TalkStep } from '../domain/talk';
import { ui } from '../lib/language';
import { useSpeechOutput } from './useSpeechOutput';
import { useVoiceCapture, type CapturedAudio } from './useVoiceCapture';

/**
 * Talk mode runs one explicit loop: speak the current prompt, then listen, then check
 * what was heard through the same path as the typed composer, then speak again.
 *
 *   idle ─start─▶ speaking ─utterance ends/fails/watchdog─▶ listening
 *   listening ─final words─▶ checking ─submitted─▶ speaking (next prompt)
 *   listening ─no words (1st)─▶ speaking (re-prompt) · (2nd)─▶ paused ─continue─▶ speaking
 *   any ─Stop / context change / mic or recognition failure / done / escalation─▶ ended
 *
 * It never listens while speaking: capture starts only after the utterance ended, failed
 * or the watchdog fired, and every speak first cancels capture. Each step carries a turn
 * token, so a callback from an earlier turn (or a cancelled loop) changes nothing.
 */
export type TalkPhase = 'idle' | 'speaking' | 'listening' | 'checking' | 'paused' | 'ended';
export type TalkEnd =
  | 'complete'
  | 'escalated'
  | 'stopped'
  | 'microphone'
  | 'recognition'
  | 'failed'
  | 'rejected'
  | 'interrupted';

export interface TalkSnapshot {
  phase: TalkPhase;
  step: TalkStep | null;
  /** What is being (or was last) said and shown. */
  prompt: string;
  /** Final words heard in the latest listening turn. */
  heard: string;
  /** Live words while listening. */
  live: string;
  /** False once the device had no usable voice: prompts are shown, not spoken. */
  voiceOut: boolean;
  /** Microphone capture has begun for this listening turn. */
  recording: boolean;
  end: TalkEnd | null;
}

export interface TalkVoiceOut {
  /** False when nothing will be spoken (no matching voice); `done` then never runs. */
  speak(text: string, done: (outcome: 'ended' | 'failed') => void): boolean;
  stop(): void;
}
export interface TalkVoiceIn {
  canRecord: boolean;
  canTranscribe: boolean;
  start(): void;
  /** Ends listening; the capture then delivers its audio and final words. */
  finish(): void;
  cancel(): void;
}
export interface TalkDeps {
  out: TalkVoiceOut;
  in: TalkVoiceIn;
  /** The step for the handover as it is now (read fresh after every change). */
  step(): TalkStep;
  language: Language;
  noSpeechPrompt(): string;
  /** Submits heard words exactly as the composer would; false when nothing was recorded. */
  submit(text: string, audio: CapturedAudio | null, scope: string | null): Promise<boolean>;
  /** Confirms every matching item through the existing confirm path. */
  confirm(): boolean;
}

export const TALK_TIMING = {
  /** Silence after words before listening ends. */
  silenceMs: 1_600,
  /** No words at all after recording began. */
  noSpeechMs: 8_000,
  /** Upper bound for one answer. */
  maxListenMs: 45_000,
  /** If a voice never reports the end of an utterance, listen anyway after this long. */
  speechWatchdogMs: (text: string) => Math.min(60_000, 4_000 + text.length * 110),
};

/** Recognition errors that only mean nothing was said. */
const SILENT_ERRORS = new Set(['no-speech', 'aborted']);

export class TalkController {
  private snapshot: TalkSnapshot = {
    phase: 'idle',
    step: null,
    prompt: '',
    heard: '',
    live: '',
    voiceOut: true,
    recording: false,
    end: null,
  };
  private turn = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private silence: ReturnType<typeof setTimeout> | null = null;
  private noSpeech: ReturnType<typeof setTimeout> | null = null;
  private audio: CapturedAudio | null = null;
  private missed = 0;

  constructor(
    private deps: () => TalkDeps,
    private onChange: (snapshot: TalkSnapshot) => void,
  ) {}

  get state(): TalkSnapshot {
    return this.snapshot;
  }
  get active(): boolean {
    return this.snapshot.phase !== 'idle' && this.snapshot.phase !== 'ended';
  }

  private emit(patch: Partial<TalkSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.snapshot);
  }
  private later(token: number, ms: number, run: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (token === this.turn) run();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
  private clearTimers() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.silence = this.noSpeech = null;
  }
  private next() {
    this.clearTimers();
    return ++this.turn;
  }

  /** Call from a user gesture: speech output and the microphone need one. */
  start() {
    if (this.active) return;
    const { in: capture } = this.deps();
    this.missed = 0;
    this.emit({ heard: '', live: '', end: null, voiceOut: true, step: null, prompt: '' });
    if (!capture.canRecord) return this.finish('microphone');
    if (!capture.canTranscribe) return this.finish('recognition');
    this.advance();
  }

  /** Speak the current step (optionally after a short preface), then listen. */
  private advance(preface = '') {
    const step = this.deps().step();
    const text = preface ? `${preface} ${step.prompt}` : step.prompt;
    this.emit({ step });
    this.say(text, () => {
      if (step.kind === 'done') this.finish('complete', text);
      else if (step.kind === 'escalate') this.finish('escalated', text);
      else this.listen();
    });
  }

  private say(text: string, then: () => void) {
    const { in: capture, out } = this.deps();
    capture.cancel();
    const token = this.next();
    this.emit({ phase: 'speaking', prompt: text, live: '', recording: false });
    let settled = false;
    const done = () => {
      if (settled || token !== this.turn) return;
      settled = true;
      this.clearTimers();
      then();
    };
    const speaking = out.speak(text, done);
    if (!speaking) {
      // Voice in without voice out: the prompt stays on screen in large type.
      if (this.snapshot.voiceOut) this.emit({ voiceOut: false });
      this.later(token, 0, done);
      return;
    }
    this.later(token, TALK_TIMING.speechWatchdogMs(text), () => {
      this.deps().out.stop();
      done();
    });
  }

  private listen() {
    const { in: capture, out } = this.deps();
    out.stop();
    const token = this.next();
    this.audio = null;
    this.emit({ phase: 'listening', heard: '', live: '', recording: false });
    if (token !== this.turn) return;
    capture.start();
  }

  /** Capture began recording: bound the turn. */
  captureRecording() {
    if (this.snapshot.phase !== 'listening' || this.snapshot.recording) return;
    this.emit({ recording: true });
    const token = this.turn;
    this.noSpeech = this.later(token, TALK_TIMING.noSpeechMs, () => this.finishListening());
    this.later(token, TALK_TIMING.maxListenMs, () => this.finishListening());
  }

  captureInterim(words: string) {
    if (this.snapshot.phase !== 'listening') return;
    this.emit({ live: words });
    if (!words.trim()) return;
    if (this.noSpeech !== null) clearTimeout(this.noSpeech);
    if (this.silence !== null) clearTimeout(this.silence);
    this.noSpeech = null;
    this.silence = this.later(this.turn, TALK_TIMING.silenceMs, () => this.finishListening());
  }

  /** Silence, the time limit or the "Done speaking" button. */
  finishListening() {
    if (this.snapshot.phase !== 'listening' || !this.snapshot.recording) return;
    if (this.silence !== null) clearTimeout(this.silence);
    if (this.noSpeech !== null) clearTimeout(this.noSpeech);
    this.silence = this.noSpeech = null;
    this.deps().in.finish();
  }

  captureAudio(audio: CapturedAudio) {
    if (this.snapshot.phase === 'listening') this.audio = audio;
  }

  /** Final words; the empty text sent when recording starts is ignored (no audio yet). */
  captureText(text: string) {
    if (this.snapshot.phase !== 'listening' || !this.audio) return;
    const audio = this.audio;
    this.audio = null;
    const token = this.next();
    // Leave the capture callback before acting on its result.
    this.later(token, 0, () => this.heard(text.trim(), audio));
  }

  captureFailed() {
    if (this.snapshot.phase !== 'listening') return;
    this.finish(this.snapshot.recording ? 'failed' : 'microphone');
  }

  private heard(text: string, audio: CapturedAudio) {
    if (
      audio.transcriptionFailed &&
      !text &&
      audio.recognitionError &&
      !SILENT_ERRORS.has(audio.recognitionError)
    )
      return this.finish('recognition');
    if (!text) {
      this.missed += 1;
      if (this.missed === 1) return this.advance(this.deps().noSpeechPrompt());
      this.next();
      this.emit({ phase: 'paused', live: '', recording: false });
      return;
    }
    this.missed = 0;
    const asked = this.snapshot.step;
    const deps = this.deps();
    const now = deps.step();
    this.emit({ phase: 'checking', heard: text, live: '', recording: false });
    // The handover moved on since the question was asked: ask the current one instead.
    if (!asked || now.key !== asked.key) return this.advance();
    if (talkReply(asked, text, deps.language) === 'confirm') {
      if (!deps.confirm()) return this.finish('rejected');
      return this.advance();
    }
    const token = this.turn;
    void deps.submit(text, audio, talkScope(asked)).then(
      (ok) => {
        if (token !== this.turn) return;
        if (ok) this.advance();
        else this.finish('rejected');
      },
      () => {
        if (token === this.turn) this.finish('rejected');
      },
    );
  }

  /** The on-screen alternative to the spoken confirm phrase. */
  confirmByTap() {
    const asked = this.snapshot.step;
    if (!this.active || asked?.kind !== 'confirm') return;
    const deps = this.deps();
    if (deps.step().key !== asked.key) return this.advance();
    deps.in.cancel();
    deps.out.stop();
    this.next();
    this.emit({ phase: 'checking', live: '', recording: false });
    if (!deps.confirm()) return this.finish('rejected');
    this.advance();
  }

  /** "Tap to continue" after a pause. */
  resume() {
    if (this.snapshot.phase !== 'paused') return;
    this.missed = 0;
    this.advance();
  }

  stop() {
    if (this.active) this.finish('stopped');
  }

  /** The handover, its instructions or the language changed, or the tab went stale. */
  interrupt() {
    if (this.active) this.finish('interrupted');
  }

  /** Back to idle after an ended loop has been dismissed. */
  reset() {
    if (this.active) this.finish('stopped');
    this.emit({ phase: 'idle', end: null, heard: '', live: '', prompt: '', step: null });
  }

  dispose() {
    this.next();
    const { in: capture, out } = this.deps();
    capture.cancel();
    out.stop();
  }

  private finish(end: TalkEnd, prompt?: string) {
    this.next();
    const { in: capture, out } = this.deps();
    capture.cancel();
    out.stop();
    this.audio = null;
    this.emit({
      phase: 'ended',
      end,
      live: '',
      recording: false,
      ...(prompt !== undefined ? { prompt } : {}),
    });
  }
}

/**
 * React binding: browser speech output and capture, keyed to the handover context, so a
 * handover switch, instruction revision or language change cancels both and ends the loop.
 */
export function useTalkMode({
  language,
  contextKey,
  current,
  submit,
  confirm,
  blocked = false,
}: {
  language: Language;
  contextKey: string;
  /** The handover as it is now, read after every change. */
  current: () => HandoverState | undefined;
  submit: TalkDeps['submit'];
  confirm: TalkDeps['confirm'];
  blocked?: boolean;
}) {
  const key = `talk:${contextKey}`;
  const speech = useSpeechOutput(language, key);
  const controller = useRef<TalkController | null>(null);
  const capture = useVoiceCapture(
    language,
    (text) => controller.current?.captureText(text),
    (audio) => controller.current?.captureAudio(audio),
    key,
  );
  const deps = useRef<TalkDeps | null>(null);
  deps.current = {
    out: { speak: (text, done) => speech.speak(text, done), stop: () => speech.stop() },
    in: {
      canRecord: capture.canRecord,
      canTranscribe: capture.canTranscribe,
      start: () => void capture.start(),
      finish: () => capture.stop(),
      cancel: () => capture.cancel(),
    },
    step: () => {
      const state = current();
      if (!state) throw new Error('This handover no longer exists.');
      return talkStep(state, language);
    },
    language,
    noSpeechPrompt: () => ui(language, 'talkNoSpeech'),
    submit,
    confirm,
  };
  const [snapshot, setSnapshot] = useState<TalkSnapshot>(() => ({
    phase: 'idle',
    step: null,
    prompt: '',
    heard: '',
    live: '',
    voiceOut: true,
    recording: false,
    end: null,
  }));
  if (!controller.current)
    controller.current = new TalkController(() => deps.current!, setSnapshot);

  useEffect(() => {
    if (capture.status === 'recording') controller.current?.captureRecording();
    if (capture.status === 'error') controller.current?.captureFailed();
  }, [capture.status]);
  useEffect(() => {
    controller.current?.captureInterim(capture.interim);
  }, [capture.interim]);
  useEffect(() => {
    if (blocked) controller.current?.interrupt();
  }, [blocked]);
  const firstKey = useRef(key);
  useEffect(() => {
    if (firstKey.current === key) return;
    firstKey.current = key;
    controller.current?.interrupt();
  }, [key]);
  useEffect(() => () => controller.current?.dispose(), []);

  const start = useCallback(() => controller.current?.start(), []);
  const stop = useCallback(() => controller.current?.stop(), []);
  const resume = useCallback(() => controller.current?.resume(), []);
  const reset = useCallback(() => controller.current?.reset(), []);
  const finishListening = useCallback(() => controller.current?.finishListening(), []);
  const confirmByTap = useCallback(() => controller.current?.confirmByTap(), []);
  return { ...snapshot, start, stop, resume, reset, finishListening, confirmByTap };
}
