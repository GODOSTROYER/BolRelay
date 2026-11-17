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
}

/** Browser-native capture; audio is never sent by this hook to an application server. */
export function useVoiceCapture(
  language: Language,
  onText: (text: string) => void,
  onAudio: (audio: CapturedAudio) => void,
) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
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

  const stop = useCallback(() => {
    recognition.current?.stop();
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    else stream.current?.getTracks().forEach((track) => track.stop());
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    setInterim('');
  }, []);

  const start = useCallback(async () => {
    if (recording || starting) return;
    setStarting(true);
    setError('');
    setSeconds(0);
    setInterim('');
    try {
      if (!canRecord)
        throw new Error(
          'Microphone recording needs a secure browser with audio capture. You can still type your words.',
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      rec.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (mounted.current && chunks.length)
          callbacks.current.onAudio({
            blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }),
            duration: (Date.now() - startedAt.current) / 1000,
          });
      };
      recorder.current = rec;
      startedAt.current = Date.now();
      rec.start(250);
      setRecording(true);
      timer.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
        1000,
      );
      if (speechConstructor) {
        const speech = new speechConstructor();
        let finalText = '';
        speech.lang = language;
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (event) => {
          let live = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (!result) continue;
            if (result.isFinal) finalText += `${result[0].transcript} `;
            else live += result[0].transcript;
          }
          if (mounted.current) {
            setInterim(live);
            if (finalText.trim()) callbacks.current.onText(finalText.trim());
          }
        };
        speech.onerror = (event) => {
          if (mounted.current && event.error !== 'aborted')
            setError(
              event.error === 'not-allowed'
                ? 'Browser dictation was not allowed. Audio is still recording; type the transcript before checking.'
                : 'Browser dictation could not transcribe this recording. Type or correct the transcript before checking.',
            );
        };
        recognition.current = speech;
        try {
          speech.start();
        } catch {
          setError(
            'Browser dictation could not start. Audio is recording; type the transcript before checking.',
          );
        }
      } else
        setError(
          'This browser records audio but does not offer dictation. Type the transcript before checking.',
        );
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop());
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Microphone access was declined. Allow it in your browser, or type your words below.'
          : cause instanceof Error
            ? cause.message
            : 'Could not start the microphone. You can type your words instead.',
      );
    } finally {
      if (mounted.current) setStarting(false);
    }
  }, [canRecord, language, recording, starting, speechConstructor]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recognition.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    if (recording && seconds >= 120) stop();
  }, [recording, seconds, stop]);
  return {
    recording,
    starting,
    error,
    seconds,
    interim,
    canRecord,
    canTranscribe: !!speechConstructor,
    start,
    stop,
  };
}
