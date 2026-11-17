import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '../domain/types';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>;
  resultIndex: number;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export interface CapturedAudio {
  blob: Blob;
  duration: number;
  /** Identifies a completed capture, not a stored domain utterance. */
  captureId?: string;
}

export type CaptureStatus = 'idle' | 'starting' | 'recording' | 'finalizing' | 'ready' | 'error';
export const CAPTURE_FINALIZATION_TIMEOUT_MS = 5_000;

interface CaptureSession {
  id: number;
  context: string;
  media: MediaStream | null;
  recorder: MediaRecorder | null;
  recognition: Recognition | null;
  chunks: BlobPart[];
  finalWords: Map<number, string>;
  startedAt: number;
  stoppedAt: number | null;
  stopRequested: boolean;
  recorderDone: boolean;
  recognitionDone: boolean;
  transcriptionFailed: boolean;
  settled: boolean;
  clock: ReturnType<typeof setInterval> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  onText: (text: string) => void;
  onAudio: (audio: CapturedAudio) => void;
}

function clearTimers(session: CaptureSession) {
  if (session.clock !== null) clearInterval(session.clock);
  if (session.deadline !== null) clearTimeout(session.deadline);
  session.clock = session.deadline = null;
}

function dispose(session: CaptureSession) {
  clearTimers(session);
  const speech = session.recognition;
  if (speech) {
    speech.onresult = speech.onerror = speech.onend = null;
    try {
      speech.abort();
    } catch {
      /* Already ended. */
    }
  }
  const recorder = session.recorder;
  if (recorder) {
    recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* Already stopped. */
    }
  }
  session.media?.getTracks().forEach((track) => track.stop());
}

/**
 * Audio stays in this browser; browser dictation may use its own online service.
 * Audio and final words are delivered as one completed session. The caller must
 * clear previously delivered audio when starting a new capture.
 */
export function useVoiceCapture(
  language: Language,
  onText: (text: string) => void,
  onAudio: (audio: CapturedAudio) => void,
  contextKey = '',
) {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
  const current = useRef<CaptureSession | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const context = language + '\u0000' + contextKey;
  const activeContext = useRef(context);
  activeContext.current = context;
  const callbacks = useRef({ onText, onAudio });
  callbacks.current = { onText, onAudio };
  const speechConstructor =
    typeof window === 'undefined'
      ? undefined
      : ((window as SpeechWindow).SpeechRecognition ??
        (window as SpeechWindow).webkitSpeechRecognition);
  const canRecord =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const isCurrent = useCallback(
    (session: CaptureSession) =>
      mounted.current &&
      current.current === session &&
      activeContext.current === session.context &&
      !session.settled,
    [],
  );

  const fail = useCallback(
    (session: CaptureSession, message: string) => {
      if (!isCurrent(session)) return;
      session.settled = true;
      dispose(session);
      setInterim('');
      setError(message);
      setStatus('error');
    },
    [isCurrent],
  );

  const finish = useCallback(
    (session: CaptureSession) => {
      if (
        !isCurrent(session) ||
        !session.stopRequested ||
        !session.recorderDone ||
        !session.recognitionDone
      )
        return;
      const blob = new Blob(session.chunks, { type: session.recorder?.mimeType || 'audio/webm' });
      if (!blob.size) {
        fail(session, 'The recording was empty. Try recording again, or type your words.');
        return;
      }
      session.settled = true;
      dispose(session);
      const text = session.transcriptionFailed
        ? ''
        : [...session.finalWords]
            .sort(([a], [b]) => a - b)
            .map(([, words]) => words)
            .join(' ')
            .trim();
      session.onAudio({
        blob,
        duration: Math.max(0, ((session.stoppedAt ?? Date.now()) - session.startedAt) / 1000),
        captureId: String(session.startedAt) + '-' + session.id,
      });
      session.onText(text);
      if (!text && !session.transcriptionFailed)
        setError(
          'No final words were recognized. Listen to the recording and type the transcript, or record again.',
        );
      setInterim('');
      setStatus('ready');
    },
    [fail, isCurrent],
  );

  const finalize = useCallback(
    (session: CaptureSession) => {
      if (!isCurrent(session) || session.stopRequested) return;
      session.stopRequested = true;
      session.stoppedAt = Date.now();
      if (session.clock !== null) clearInterval(session.clock);
      session.clock = null;
      setSeconds(Math.floor((session.stoppedAt - session.startedAt) / 1000));
      setStatus('finalizing');
      session.deadline = setTimeout(() => {
        if (!isCurrent(session)) return;
        if (!session.recorderDone) {
          fail(
            session,
            'The recording did not finish. Record again, or type your words; no audio was attached.',
          );
          return;
        }
        // Never publish a partial transcript when recognition did not finalize.
        session.transcriptionFailed = true;
        session.recognitionDone = true;
        setError(
          'Dictation did not finish. The recording is saved; listen and type its transcript, or record again.',
        );
        finish(session);
      }, CAPTURE_FINALIZATION_TIMEOUT_MS);
      try {
        if (!session.recognitionDone) session.recognition?.stop();
      } catch {
        session.recognitionDone = true;
        session.transcriptionFailed = true;
        setError('Dictation could not finish. Listen to the recording and type its transcript.');
      }
      try {
        if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
      } catch {
        fail(session, 'The recording could not be completed. Record again, or type your words.');
        return;
      }
      finish(session);
    },
    [fail, finish, isCurrent],
  );

  const cancel = useCallback(() => {
    const session = current.current;
    current.current = null;
    if (session) {
      session.settled = true;
      dispose(session);
    }
    if (mounted.current) {
      setStatus('idle');
      setError('');
      setSeconds(0);
      setInterim('');
    }
  }, []);

  const stop = useCallback(() => {
    const session = current.current;
    if (!session || !isCurrent(session)) return;
    if (!session.recorder) cancel();
    else finalize(session);
  }, [cancel, finalize, isCurrent]);

  const start = useCallback(async () => {
    // The live session guards double clicks, including a pending permission prompt.
    if (current.current && !current.current.settled) return;
    if (current.current) dispose(current.current);
    const session: CaptureSession = {
      id: ++sequence.current,
      context,
      media: null,
      recorder: null,
      recognition: null,
      chunks: [],
      finalWords: new Map(),
      startedAt: 0,
      stoppedAt: null,
      stopRequested: false,
      recorderDone: false,
      recognitionDone: !speechConstructor,
      transcriptionFailed: !speechConstructor,
      settled: false,
      clock: null,
      deadline: null,
      ...callbacks.current,
    };
    current.current = session;
    setStatus('starting');
    setError('');
    setSeconds(0);
    setInterim('');
    try {
      if (!canRecord)
        throw new Error(
          'Microphone recording needs a secure browser with audio capture. You can type your words.',
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!isCurrent(session)) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      session.media = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (isCurrent(session) && event.data.size) session.chunks.push(event.data);
      };
      recorder.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (!isCurrent(session)) return;
        session.recorderDone = true;
        if (!session.stopRequested) finalize(session);
        finish(session);
      };
      recorder.onerror = () =>
        fail(
          session,
          'Audio recording failed. Record again, or type your words; no audio was attached.',
        );
      session.startedAt = Date.now();
      recorder.start(250);
      // Silence or failed speech recognition must not reuse the previous words.
      session.onText('');
      setStatus('recording');
      session.clock = setInterval(() => {
        if (!isCurrent(session) || session.stopRequested) return;
        const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 120) finalize(session);
      }, 1000);
      if (!speechConstructor) {
        setError(
          'This browser records audio but does not offer dictation. Listen and type the transcript after stopping.',
        );
        return;
      }
      const speech = new speechConstructor();
      session.recognition = speech;
      speech.lang = language;
      speech.continuous = true;
      speech.interimResults = true;
      speech.onresult = (event) => {
        if (!isCurrent(session) || session.recognitionDone) return;
        const live: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          if (result.isFinal) session.finalWords.set(i, result[0].transcript.trim());
          else live.push(result[0].transcript);
        }
        setInterim(
          [...[...session.finalWords].sort(([a], [b]) => a - b).map(([, words]) => words), ...live]
            .join(' ')
            .trim(),
        );
      };
      speech.onerror = (event) => {
        if (!isCurrent(session)) return;
        session.transcriptionFailed = true;
        session.recognitionDone = true;
        setError(
          event.error === 'not-allowed'
            ? 'Browser dictation was not allowed. Listen to the saved recording and type its transcript.'
            : 'Browser dictation failed. Listen to the saved recording and type its transcript, or record again.',
        );
        finalize(session);
        finish(session);
      };
      speech.onend = () => {
        if (!isCurrent(session)) return;
        session.recognitionDone = true;
        if (!session.stopRequested) {
          setError(
            'Dictation ended and the recording stopped. Review the captured words before continuing.',
          );
          finalize(session);
        }
        finish(session);
      };
      try {
        speech.start();
      } catch {
        session.recognitionDone = true;
        session.transcriptionFailed = true;
        setError(
          'Browser dictation could not start. Audio is recording; listen and type its transcript after stopping.',
        );
      }
    } catch (cause) {
      fail(
        session,
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Microphone access was declined. Allow it in your browser, or type your words below.'
          : cause instanceof Error
            ? cause.message
            : 'Could not start the microphone. You can type your words instead.',
      );
    }
  }, [canRecord, context, fail, finalize, finish, isCurrent, language, speechConstructor]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = current.current;
      current.current = null;
      if (session) {
        session.settled = true;
        dispose(session);
      }
    };
  }, []);

  useEffect(() => {
    cancel();
  }, [context, cancel]);

  return {
    status,
    recording: status === 'recording',
    starting: status === 'starting',
    finalizing: status === 'finalizing',
    busy: status === 'starting' || status === 'recording' || status === 'finalizing',
    error,
    seconds,
    interim,
    canRecord,
    canTranscribe: !!speechConstructor,
    start,
    stop,
    cancel,
  };
}
