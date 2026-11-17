import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '../domain/types';

const normalLanguage = (language: string) => language.toLowerCase().replace(/_/g, '-');

/** Never substitute an unrelated language merely because it is the browser default. */
export function matchingVoice(voices: readonly SpeechSynthesisVoice[], language: Language) {
  const requested = normalLanguage(language);
  const exact = voices.filter((voice) => normalLanguage(voice.lang) === requested);
  const related = voices.filter(
    (voice) => normalLanguage(voice.lang).split('-')[0] === requested.split('-')[0],
  );
  const candidates = exact.length ? exact : related;
  return candidates.find((voice) => voice.localService) ?? candidates[0] ?? null;
}

let activeOutput: { owner: symbol; release: () => void } | null = null;

/** Use before recording so speech playback and its UI state stop together. */
export function stopSpeechOutput() {
  activeOutput?.release();
}

/** Explicit, cancellable browser speech output; availability is checked per language. */
export function useSpeechOutput(language: Language, contextKey = '') {
  const synthesis =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const supported = !!synthesis && typeof SpeechSynthesisUtterance !== 'undefined';
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synthesis?.getVoices() ?? []);
  const [speaking, setSpeaking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const owner = useRef(Symbol('bolrelay-speech'));
  const mounted = useRef(true);
  const generation = useRef(0);
  const context = language + '\u0000' + contextKey;
  const latestContext = useRef(context);
  latestContext.current = context;
  const voice = matchingVoice(voices, language);

  const stop = useCallback(() => {
    generation.current++;
    if (activeOutput?.owner === owner.current) activeOutput.release();
    if (mounted.current) {
      setSpeaking(false);
      setPending(false);
    }
  }, []);

  const speak = useCallback(
    (words: string) => {
      const text = words.trim();
      if (!text) return false;
      const selected = synthesis ? matchingVoice(synthesis.getVoices(), language) : null;
      if (!supported || !synthesis || !selected) {
        stop();
        setError(
          !supported
            ? 'Spoken playback is unavailable in this browser. Read the displayed instruction.'
            : 'This browser has no voice for the selected language. Use the displayed text or enable a matching device voice.',
        );
        return false;
      }
      if (text.length > 4_000) {
        setError('This passage is too long for spoken playback. Listen to one item at a time.');
        return false;
      }
      // Only an explicit new speak action may interrupt another BolRelay speech control.
      activeOutput?.release();
      const token = ++generation.current;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = selected;
      utterance.lang = language;
      utterance.rate = 0.95;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      let released = false;
      const current = () =>
        !released &&
        mounted.current &&
        generation.current === token &&
        latestContext.current === context &&
        activeOutput?.owner === owner.current;
      const release = () => {
        if (released) return;
        released = true;
        if (deadline !== null) clearTimeout(deadline);
        utterance.onstart = utterance.onend = utterance.onerror = null;
        if (activeOutput?.owner === owner.current) {
          activeOutput = null;
          synthesis.cancel();
        }
        if (mounted.current) {
          setSpeaking(false);
          setPending(false);
        }
      };
      activeOutput = { owner: owner.current, release };
      setError('');
      setPending(true);
      setSpeaking(false);
      utterance.onstart = () => {
        if (!current()) return;
        if (deadline !== null) clearTimeout(deadline);
        setPending(false);
        setSpeaking(true);
        deadline = setTimeout(() => {
          if (!current()) return;
          release();
          setError(
            'Spoken playback did not finish. Try one item at a time or use the displayed text.',
          );
        }, 120_000);
      };
      utterance.onend = () => {
        if (current()) release();
      };
      utterance.onerror = (event) => {
        if (!current()) return;
        release();
        if (event.error !== 'canceled' && event.error !== 'interrupted')
          setError('Spoken playback failed. Try again or use the displayed text.');
      };
      deadline = setTimeout(() => {
        if (!current()) return;
        release();
        setError('The selected voice did not start. Try again or use the displayed text.');
      }, 5_000);
      try {
        synthesis.speak(utterance);
      } catch {
        release();
        setError('Spoken playback could not start. Use the displayed text.');
        return false;
      }
      return true;
    },
    [context, language, stop, supported, synthesis],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (!synthesis) return;
    const update = () => setVoices(synthesis.getVoices());
    update();
    synthesis.addEventListener('voiceschanged', update);
    return () => synthesis.removeEventListener('voiceschanged', update);
  }, [synthesis]);

  useEffect(() => {
    setError('');
    return stop;
  }, [context, stop]);

  return {
    available: supported && !!voice,
    supported,
    voiceName: voice?.name ?? null,
    localVoice: voice?.localService ?? false,
    speaking,
    pending,
    error,
    speak,
    stop,
  };
}
