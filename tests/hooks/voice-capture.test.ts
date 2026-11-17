import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedAudio } from '../../src/hooks/useVoiceCapture';

const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void };
  const slots: Slot[] = [];
  let cursor = 0;
  let dirty = false;
  const effects: (() => void)[] = [];
  const equal = (a: readonly unknown[] | undefined, b: readonly unknown[]) =>
    !!a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    reset() {
      slots.length = 0;
      effects.length = 0;
      cursor = 0;
      dirty = false;
    },
    begin() {
      cursor = 0;
      dirty = false;
    },
    flush() {
      while (effects.length) effects.shift()!();
      return dirty;
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!slots[index])
        slots[index] = { value: typeof initial === 'function' ? (initial as () => T)() : initial };
      const set = (next: T | ((previous: T) => T)) => {
        const value =
          typeof next === 'function' ? (next as (previous: T) => T)(slots[index].value as T) : next;
        if (!Object.is(value, slots[index].value)) dirty = true;
        slots[index].value = value;
      };
      return [slots[index].value as T, set] as const;
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value as { current: T };
    },
    useCallback<T>(callback: T, dependencies: readonly unknown[]) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].dependencies, dependencies))
        slots[index] = { value: callback, dependencies };
      return slots[index].value as T;
    },
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !equal(previous.dependencies, dependencies)) {
        slots[index] = { dependencies, cleanup: previous?.cleanup };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect() || undefined;
        });
      }
    },
  };
});
vi.mock('react', () => ({
  useState: hooks.useState,
  useRef: hooks.useRef,
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
}));

import { CAPTURE_FINALIZATION_TIMEOUT_MS, useVoiceCapture } from '../../src/hooks/useVoiceCapture';

class MockRecorder {
  static instances: MockRecorder[] = [];
  static isTypeSupported() {
    return true;
  }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    MockRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  data(words = 'audio sample') {
    this.ondataavailable?.({ data: new Blob([words]) });
  }
  ended() {
    this.state = 'inactive';
    this.onstop?.();
  }
}
type SpeechResultEvent = {
  resultIndex: number;
  results: { isFinal: boolean; 0: { transcript: string } }[];
};
class MockSpeech {
  static instances: MockSpeech[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: SpeechResultEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor() {
    MockSpeech.instances.push(this);
  }
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  words(text: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
}
const text = vi.fn<(value: string) => void>();
const audio = vi.fn<(value: CapturedAudio) => void>();
let context = 'handover-A:incoming';
let trackStop = vi.fn();
let getUserMedia = vi.fn();
function render() {
  let result!: ReturnType<typeof useVoiceCapture>;
  let iterations = 0;
  do {
    hooks.begin();
    result = useVoiceCapture('en-IN', text, audio, context);
    if (++iterations > 10) throw new Error('Hook did not stabilize');
  } while (hooks.flush());
  return result;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
  hooks.reset();
  text.mockClear();
  audio.mockClear();
  MockRecorder.instances = [];
  MockSpeech.instances = [];
  context = 'handover-A:incoming';
  trackStop = vi.fn();
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', MockRecorder);
  vi.stubGlobal('window', { SpeechRecognition: MockSpeech });
});
afterEach(() => {
  hooks.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('actual voice hook with controlled media events (not microphone accuracy)', () => {
  it('stays finalizing until audio and recognition finish, then publishes one complete capture', async () => {
    await render().start();
    const recorder = MockRecorder.instances[0];
    const speech = MockSpeech.instances[0];
    speech.words('Eight parcels after three PM');
    // Repeated finalized indexes replace the same result rather than duplicate it.
    speech.words('Eight parcels after three PM');
    expect(text.mock.calls).toEqual([['']]);
    vi.advanceTimersByTime(2_000);
    render().stop();
    expect(render()).toMatchObject({ status: 'finalizing', busy: true, finalizing: true });
    expect(audio).not.toHaveBeenCalled();
    await render().start();
    expect(MockRecorder.instances).toHaveLength(1);
    recorder.data();
    recorder.ended();
    expect(render().finalizing).toBe(true);
    expect(audio).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    speech.onend?.();
    expect(render()).toMatchObject({ status: 'ready', busy: false, interim: '' });
    expect(audio).toHaveBeenCalledTimes(1);
    expect(audio.mock.calls[0][0].duration).toBe(2);
    expect(text).toHaveBeenLastCalledWith('Eight parcels after three PM');
  });

  it('ignores delayed callbacks from a cancelled capture after the next recording starts', async () => {
    await render().start();
    const oldRecorder = MockRecorder.instances[0],
      oldSpeech = MockSpeech.instances[0];
    const oldData = oldRecorder.ondataavailable!,
      oldStop = oldRecorder.onstop!,
      oldWords = oldSpeech.onresult!;
    vi.advanceTimersByTime(2_000);
    render().stop();
    render().cancel();
    await render().start();
    const recorder = MockRecorder.instances[1],
      speech = MockSpeech.instances[1];
    speech.words('New recording words');
    oldData({ data: new Blob(['OLD AUDIO']) });
    oldStop();
    oldWords({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'OLD recording words' } }],
    });
    expect(render().interim).toBe('New recording words');
    expect(audio).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    render().stop();
    speech.onend?.();
    recorder.data('NEW AUDIO');
    recorder.ended();
    expect(audio).toHaveBeenCalledTimes(1);
    expect(await audio.mock.calls[0][0].blob.text()).toBe('NEW AUDIO');
    expect(audio.mock.calls[0][0].duration).toBe(1);
    expect(text).toHaveBeenLastCalledWith('New recording words');
    oldWords({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'LATE OLD WORDS' } }] });
    expect(text).toHaveBeenLastCalledWith('New recording words');
  });

  it('does not start twice while permission is pending, and rejects permission granted to an old context', async () => {
    let allow!: (value: unknown) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          allow = resolve;
        }),
    );
    const pending = render().start();
    await render().start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(render().starting).toBe(true);
    context = 'handover-B:outgoing';
    expect(render().status).toBe('idle');
    allow({ getTracks: () => [{ stop: trackStop }] });
    await pending;
    expect(trackStop).toHaveBeenCalled();
    expect(MockRecorder.instances).toHaveLength(0);
    expect(audio).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it('cancels a live capture and ignores retained callbacks after context changes', async () => {
    await render().start();
    const recorder = MockRecorder.instances[0],
      speech = MockSpeech.instances[0];
    const callback = speech.onresult!;
    context = 'handover-A:outgoing';
    expect(render()).toMatchObject({ status: 'idle', busy: false });
    callback({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'old role' } }] });
    expect(render().interim).toBe('');
    expect(audio).not.toHaveBeenCalled();
    expect(recorder.stop).toHaveBeenCalled();
    expect(speech.abort).toHaveBeenCalled();
  });

  it('times out incomplete recognition with saved audio and an empty transcript', async () => {
    await render().start();
    const recorder = MockRecorder.instances[0],
      speech = MockSpeech.instances[0];
    speech.words('Incomplete words before a missing final clause');
    const lateWords = speech.onresult!;
    render().stop();
    recorder.data();
    recorder.ended();
    vi.advanceTimersByTime(CAPTURE_FINALIZATION_TIMEOUT_MS);
    expect(render()).toMatchObject({ status: 'ready', busy: false });
    expect(render().error).toMatch(/Dictation did not finish/);
    expect(audio).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenLastCalledWith('');
    lateWords({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late result' } }] });
    expect(text).toHaveBeenLastCalledWith('');
  });

  it('fails a recorder that never finishes without publishing a partial capture', async () => {
    await render().start();
    const speech = MockSpeech.instances[0];
    speech.words('A partial result');
    render().stop();
    speech.onend?.();
    vi.advanceTimersByTime(CAPTURE_FINALIZATION_TIMEOUT_MS);
    expect(render()).toMatchObject({ status: 'error', busy: false });
    expect(render().error).toMatch(/recording did not finish/);
    expect(audio).not.toHaveBeenCalled();
    expect(text.mock.calls).toEqual([['']]);
  });

  it('stops capture when dictation ends unexpectedly and exposes that event', async () => {
    await render().start();
    const recorder = MockRecorder.instances[0],
      speech = MockSpeech.instances[0];
    speech.words('The final recognized words');
    speech.onend?.();
    expect(render().finalizing).toBe(true);
    expect(recorder.stop).toHaveBeenCalled();
    recorder.data();
    recorder.ended();
    expect(render().status).toBe('ready');
    expect(render().error).toMatch(/Dictation ended/);
    expect(text).toHaveBeenLastCalledWith('The final recognized words');
  });

  it('saves audio without inventing a transcript when browser dictation is unavailable', async () => {
    vi.stubGlobal('window', {});
    await render().start();
    const recorder = MockRecorder.instances[0];
    render().stop();
    recorder.data();
    recorder.ended();
    expect(render()).toMatchObject({ canTranscribe: false, status: 'ready' });
    expect(render().error).toMatch(/does not offer dictation/);
    expect(audio).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenLastCalledWith('');
  });

  it('rejects empty audio and clears resources', async () => {
    await render().start();
    render().stop();
    MockSpeech.instances[0].onend?.();
    MockRecorder.instances[0].ended();
    expect(render().status).toBe('error');
    expect(render().error).toMatch(/empty/);
    expect(audio).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it('reports denied permission without publishing a capture or overwriting typed words', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await render().start();
    expect(render()).toMatchObject({ status: 'error', busy: false });
    expect(render().error).toMatch(/Microphone access was declined/);
    expect(text).not.toHaveBeenCalled();
    expect(audio).not.toHaveBeenCalled();
  });

  it('discards capture data after unmount even if callbacks were queued already', async () => {
    await render().start();
    const recorder = MockRecorder.instances[0],
      speech = MockSpeech.instances[0];
    const lateData = recorder.ondataavailable!,
      lateStop = recorder.onstop!,
      lateEnd = speech.onend!;
    hooks.unmount();
    lateData({ data: new Blob(['old']) });
    lateStop();
    lateEnd();
    expect(audio).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
    expect(speech.abort).toHaveBeenCalled();
  });

  it('automatically finalizes the bounded two-minute capture', async () => {
    await render().start();
    vi.advanceTimersByTime(120_000);
    expect(render()).toMatchObject({ status: 'finalizing', seconds: 120 });
    expect(MockRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
  });
});

import { matchingVoice, useSpeechOutput } from '../../src/hooks/useSpeechOutput';
import type { Language } from '../../src/domain/types';

class MockUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
function makeVoice(lang: string, localService = true): SpeechSynthesisVoice {
  return {
    lang,
    name: lang + (localService ? '-local' : '-remote'),
    voiceURI: lang,
    default: false,
    localService,
  };
}
function speechRuntime(initial: SpeechSynthesisVoice[]) {
  let voices = initial;
  const listeners = new Set<() => void>();
  const synthesis = {
    getVoices: () => voices,
    speak: vi.fn<(utterance: MockUtterance) => void>(),
    cancel: vi.fn(),
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('window', { speechSynthesis: synthesis });
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
  return {
    synthesis,
    voices(next: SpeechSynthesisVoice[]) {
      voices = next;
      listeners.forEach((listener) => listener());
    },
  };
}
function renderOutput(language: Language = 'hi-IN', key = context) {
  let result!: ReturnType<typeof useSpeechOutput>;
  let iterations = 0;
  do {
    hooks.begin();
    result = useSpeechOutput(language, key);
    if (++iterations > 10) throw new Error('Speech output hook did not stabilize');
  } while (hooks.flush());
  return result;
}

describe('browser speech output capability and lifecycle (mocked, not voice quality)', () => {
  it('does not silently use an English voice for Hindi or Marathi', () => {
    const runtime = speechRuntime([makeVoice('en-US')]);
    expect(renderOutput().available).toBe(false);
    expect(renderOutput().speak('दो पार्सल रोकें')).toBe(false);
    expect(runtime.synthesis.speak).not.toHaveBeenCalled();
    expect(renderOutput().error).toMatch(/no voice for the selected language/);
    expect(matchingVoice([makeVoice('en-US')], 'mr-IN')).toBeNull();
  });

  it('prefers an exact language voice, with a local voice preferred within that match', () => {
    const voices = [makeVoice('hi-IN', false), makeVoice('hi', true), makeVoice('hi-IN', true)];
    expect(matchingVoice(voices, 'hi-IN')).toBe(voices[2]);
    expect(matchingVoice([makeVoice('en-US')], 'en-IN')?.lang).toBe('en-US');
  });

  it('reports pending until the browser starts speech and clears state when it ends', () => {
    const runtime = speechRuntime([makeVoice('hi-IN')]);
    expect(renderOutput()).toMatchObject({ available: true, supported: true, localVoice: true });
    expect(renderOutput().speak('दो पार्सल रोकें')).toBe(true);
    expect(renderOutput()).toMatchObject({ pending: true, speaking: false });
    const utterance = runtime.synthesis.speak.mock.calls[0][0];
    expect(utterance.voice?.lang).toBe('hi-IN');
    expect(utterance.text).toBe('दो पार्सल रोकें');
    utterance.onstart?.();
    expect(renderOutput()).toMatchObject({ pending: false, speaking: true });
    utterance.onend?.();
    expect(renderOutput()).toMatchObject({ pending: false, speaking: false, error: '' });
  });

  it('cancels on a context change and ignores queued events from the prior prompt', () => {
    const runtime = speechRuntime([makeVoice('hi-IN')]);
    renderOutput().speak('पुराना निर्देश');
    const utterance = runtime.synthesis.speak.mock.calls[0][0];
    const oldStart = utterance.onstart!,
      oldEnd = utterance.onend!;
    context = 'new-handover:outgoing';
    expect(renderOutput()).toMatchObject({ pending: false, speaking: false });
    expect(runtime.synthesis.cancel).toHaveBeenCalledTimes(1);
    oldStart();
    oldEnd();
    expect(renderOutput()).toMatchObject({ pending: false, speaking: false });
  });

  it('does not claim speech started when the browser never emits a start event', () => {
    const runtime = speechRuntime([makeVoice('mr-IN')]);
    renderOutput('mr-IN').speak('दोन पार्सल थांबवा');
    vi.advanceTimersByTime(5_000);
    expect(renderOutput('mr-IN')).toMatchObject({ pending: false, speaking: false });
    expect(renderOutput('mr-IN').error).toMatch(/voice did not start/);
    expect(runtime.synthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('updates availability when the browser loads matching voices later', () => {
    const runtime = speechRuntime([]);
    expect(renderOutput().available).toBe(false);
    runtime.voices([makeVoice('hi-IN')]);
    expect(renderOutput().available).toBe(true);
  });

  it('handles missing speech APIs without presenting a working playback control', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
    expect(renderOutput()).toMatchObject({ available: false, supported: false });
    expect(renderOutput().speak('दो पार्सल रोकें')).toBe(false);
    expect(renderOutput().error).toMatch(/unavailable/);
  });

  it('stops the prior utterance when another prompt is explicitly requested', () => {
    const runtime = speechRuntime([makeVoice('hi-IN')]);
    renderOutput().speak('पहला निर्देश');
    const first = runtime.synthesis.speak.mock.calls[0][0];
    const lateEnd = first.onend!;
    renderOutput().speak('दूसरा निर्देश');
    expect(runtime.synthesis.speak).toHaveBeenCalledTimes(2);
    expect(runtime.synthesis.cancel).toHaveBeenCalledTimes(1);
    const second = runtime.synthesis.speak.mock.calls[1][0];
    second.onstart?.();
    lateEnd();
    expect(renderOutput().speaking).toBe(true);
    renderOutput().stop();
    expect(renderOutput()).toMatchObject({ pending: false, speaking: false });
  });
});
