import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkStep } from '../../src/domain/talk';
import type { CapturedAudio } from '../../src/hooks/useVoiceCapture';
import {
  TALK_TIMING,
  TalkController,
  type TalkDeps,
  type TalkSnapshot,
} from '../../src/hooks/useTalkMode';

/**
 * The talk-mode loop with controlled speech-output and capture doubles. The doubles
 * record every transition and flag any moment the app would listen while speaking or
 * speak while listening.
 */
function harness({ voice = true, canRecord = true, canTranscribe = true } = {}) {
  const events: string[] = [];
  let speaking: ((outcome: 'ended' | 'failed') => void) | null = null;
  let listening = false;
  const out = {
    speak: vi.fn((text: string, done: (outcome: 'ended' | 'failed') => void) => {
      if (!voice) return false;
      if (listening) events.push('ERROR:spoke-while-listening');
      events.push('speak:' + text);
      speaking = done;
      return true;
    }),
    stop: vi.fn(() => {
      speaking = null;
    }),
  };
  const capture = {
    canRecord,
    canTranscribe,
    start: vi.fn(() => {
      if (speaking) events.push('ERROR:listened-while-speaking');
      listening = true;
      events.push('listen');
    }),
    finish: vi.fn(() => events.push('finish')),
    cancel: vi.fn(() => {
      listening = false;
    }),
  };
  let step: TalkStep = { kind: 'readback', prompt: 'Say your plan.', key: 'readback-1' };
  let resolveSubmit: ((ok: boolean) => void) | null = null;
  const submit = vi.fn(
    (_text: string, _audio: CapturedAudio | null, _scope: string | null) =>
      new Promise<boolean>((resolve) => {
        resolveSubmit = resolve;
      }),
  );
  const confirm = vi.fn(() => true);
  const snapshots: TalkSnapshot[] = [];
  const deps: TalkDeps = {
    out,
    in: capture,
    step: () => step,
    language: 'en-IN',
    noSpeechPrompt: () => 'I did not hear anything.',
    submit,
    confirm,
  };
  const talk = new TalkController(
    () => deps,
    (snapshot) => snapshots.push(snapshot),
  );
  const audio = (extra: Partial<CapturedAudio> = {}): CapturedAudio => ({
    blob: new Blob(['audio']),
    duration: 1,
    ...extra,
  });
  return {
    talk,
    out,
    capture,
    submit,
    confirm,
    events,
    snapshots,
    setStep(next: TalkStep) {
      step = next;
    },
    /** The current utterance finishes. */
    spoken(outcome: 'ended' | 'failed' = 'ended') {
      const done = speaking;
      speaking = null;
      done?.(outcome);
    },
    get speaking() {
      return !!speaking;
    },
    /** Recording begins, then the capture delivers final words and their recording. */
    async hear(text: string, extra: Partial<CapturedAudio> = {}) {
      talk.captureRecording();
      // The empty transcript published when recording starts is never an answer.
      talk.captureText('');
      talk.captureAudio(audio(extra));
      listening = false;
      talk.captureText(text);
      await vi.advanceTimersByTimeAsync(0);
    },
    async settle(ok = true) {
      resolveSubmit?.(ok);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('talk mode loop', () => {
  it('speaks first and listens only after the utterance has ended', async () => {
    const h = harness();
    h.talk.start();
    expect(h.talk.state.phase).toBe('speaking');
    expect(h.out.speak).toHaveBeenCalledWith('Say your plan.', expect.any(Function));
    expect(h.capture.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.capture.start).not.toHaveBeenCalled();
    h.spoken();
    expect(h.talk.state.phase).toBe('listening');
    expect(h.capture.start).toHaveBeenCalledTimes(1);
    expect(h.events).toEqual(['speak:Say your plan.', 'listen']);
  });

  it('submits a full read-back, then asks the next question about one item', async () => {
    const h = harness();
    h.talk.start();
    h.spoken();
    h.submit.mockImplementationOnce(async (text, audio, scope) => {
      expect(text).toBe('I will send all ten parcels.');
      expect(audio?.duration).toBe(1);
      expect(scope).toBeNull();
      h.setStep({
        kind: 'clarify',
        itemId: 'J1',
        field: 'action',
        prompt: 'J1. What will you do?',
        key: 'c1',
      });
      return true;
    });
    await h.hear('  I will send all ten parcels. ');
    expect(h.talk.state.heard).toBe('I will send all ten parcels.');
    expect(h.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.talk.state.phase).toBe('speaking');
    expect(h.out.speak).toHaveBeenLastCalledWith('J1. What will you do?', expect.any(Function));
    h.spoken();
    h.submit.mockImplementationOnce(async (_text, _audio, scope) => {
      expect(scope).toBe('J1');
      return true;
    });
    await h.hear('I will hold it until the address is confirmed.');
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.events.filter((event) => event.startsWith('ERROR'))).toEqual([]);
  });

  it('confirms only for a confirm phrase said in answer to the confirm step', async () => {
    const h = harness();
    h.setStep({ kind: 'confirm', prompt: 'You said … say confirm.', key: 'k-confirm' });
    h.talk.start();
    h.spoken();
    // A bare "yes" is checked as a new full read-back.
    await h.hear('yes');
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.submit).toHaveBeenCalledWith('yes', expect.anything(), null);
    await h.settle();
    h.spoken();
    await h.hear('Confirm.');
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('treats a confirm phrase at any other step as an ordinary answer', async () => {
    for (const step of [
      { kind: 'readback', prompt: 'Say your plan.', key: 'r' },
      { kind: 'clarify', itemId: 'J1', field: 'action', prompt: 'J1?', key: 'c' },
      { kind: 'restate', itemId: 'J1', prompt: 'J1 again', key: 's' },
    ] as TalkStep[]) {
      const h = harness();
      h.setStep(step);
      h.talk.start();
      h.spoken();
      await h.hear('confirm');
      expect(h.confirm).not.toHaveBeenCalled();
      expect(h.submit).toHaveBeenCalledWith('confirm', expect.anything(), step.itemId ?? null);
    }
  });

  it('never applies words to a question the handover has moved past', async () => {
    const h = harness();
    h.setStep({ kind: 'confirm', prompt: 'Say confirm.', key: 'k1' });
    h.talk.start();
    h.spoken();
    // The instructions changed while the worker spoke.
    h.setStep({ kind: 'restate', itemId: 'J1', prompt: 'J1 changed. Say it again.', key: 'k2' });
    await h.hear('confirm');
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.out.speak).toHaveBeenLastCalledWith('J1 changed. Say it again.', expect.any(Function));
  });

  it('confirms by tap only at the confirm step', async () => {
    const h = harness();
    h.talk.start();
    h.talk.confirmByTap();
    expect(h.confirm).not.toHaveBeenCalled();
    h.talk.stop();
    h.setStep({ kind: 'confirm', prompt: 'Say confirm.', key: 'k' });
    h.talk.start();
    h.spoken();
    h.talk.confirmByTap();
    expect(h.capture.cancel).toHaveBeenCalled();
    expect(h.confirm).toHaveBeenCalledTimes(1);
  });

  it('ends after speaking the completion or the escalation', async () => {
    for (const [kind, end] of [
      ['done', 'complete'],
      ['escalate', 'escalated'],
    ] as const) {
      const h = harness();
      h.setStep({ kind, prompt: 'Final words.', key: kind });
      h.talk.start();
      expect(h.talk.state.phase).toBe('speaking');
      h.spoken();
      expect(h.talk.state).toMatchObject({ phase: 'ended', end, prompt: 'Final words.' });
      expect(h.capture.start).not.toHaveBeenCalled();
    }
  });

  it('re-prompts once when nothing was heard, then pauses until continued', async () => {
    const h = harness();
    h.talk.start();
    h.spoken();
    h.talk.captureRecording();
    await vi.advanceTimersByTimeAsync(TALK_TIMING.noSpeechMs - 1);
    expect(h.capture.finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.capture.finish).toHaveBeenCalledTimes(1);
    await h.hear('');
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.out.speak).toHaveBeenLastCalledWith(
      'I did not hear anything. Say your plan.',
      expect.any(Function),
    );
    h.spoken();
    await h.hear('   ', { transcriptionFailed: true, recognitionError: 'no-speech' });
    expect(h.talk.state.phase).toBe('paused');
    expect(h.out.speak).toHaveBeenCalledTimes(2);
    expect(h.capture.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.capture.start).toHaveBeenCalledTimes(2);
    h.talk.resume();
    expect(h.talk.state.phase).toBe('speaking');
    expect(h.out.speak).toHaveBeenLastCalledWith('Say your plan.', expect.any(Function));
  });

  it('ends listening after a pause in speech, and live words postpone it', async () => {
    const h = harness();
    h.talk.start();
    h.spoken();
    h.talk.captureRecording();
    h.talk.captureInterim('I will send');
    await vi.advanceTimersByTimeAsync(TALK_TIMING.silenceMs - 100);
    h.talk.captureInterim('I will send eight');
    await vi.advanceTimersByTimeAsync(TALK_TIMING.silenceMs - 100);
    expect(h.capture.finish).not.toHaveBeenCalled();
    expect(h.talk.state.live).toBe('I will send eight');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.capture.finish).toHaveBeenCalledTimes(1);
  });

  it('caps a long answer', async () => {
    const h = harness();
    h.talk.start();
    h.spoken();
    h.talk.captureRecording();
    for (let elapsed = 0; elapsed < TALK_TIMING.maxListenMs; elapsed += 1_000) {
      h.talk.captureInterim('words ' + elapsed);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(h.capture.finish).toHaveBeenCalledTimes(1);
  });

  it('listens anyway when a voice never reports the end of an utterance', async () => {
    const h = harness();
    h.talk.start();
    const limit = TALK_TIMING.speechWatchdogMs('Say your plan.');
    await vi.advanceTimersByTimeAsync(limit - 1);
    expect(h.capture.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.out.stop).toHaveBeenCalled();
    expect(h.capture.start).toHaveBeenCalledTimes(1);
    // A late end from the abandoned utterance changes nothing.
    h.spoken();
    expect(h.capture.start).toHaveBeenCalledTimes(1);
    expect(h.events.filter((event) => event.startsWith('ERROR'))).toEqual([]);
  });

  it('listens after a failed utterance', () => {
    const h = harness();
    h.talk.start();
    h.spoken('failed');
    expect(h.talk.state.phase).toBe('listening');
  });

  it('works without a voice: prompts are shown and listening follows', async () => {
    const h = harness({ voice: false });
    h.talk.start();
    expect(h.talk.state).toMatchObject({
      phase: 'speaking',
      voiceOut: false,
      prompt: 'Say your plan.',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.talk.state.phase).toBe('listening');
    await h.hear('I will send eight Nagpur parcels.');
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('Stop cancels speech and capture; late callbacks are ignored', async () => {
    const h = harness();
    h.talk.start();
    h.talk.stop();
    expect(h.talk.state).toMatchObject({ phase: 'ended', end: 'stopped' });
    expect(h.out.stop).toHaveBeenCalled();
    expect(h.capture.cancel).toHaveBeenCalled();
    h.spoken();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.capture.start).not.toHaveBeenCalled();

    const listening = harness();
    listening.talk.start();
    listening.spoken();
    listening.talk.stop();
    await listening.hear('I will send all ten parcels.');
    expect(listening.submit).not.toHaveBeenCalled();
  });

  it('a context change while checking stops the loop and drops the late result', async () => {
    const h = harness();
    h.talk.start();
    h.spoken();
    await h.hear('I will send all ten parcels.');
    expect(h.talk.state.phase).toBe('checking');
    h.talk.interrupt();
    expect(h.talk.state).toMatchObject({ phase: 'ended', end: 'interrupted' });
    await h.settle(true);
    expect(h.out.speak).toHaveBeenCalledTimes(1);
    expect(h.capture.start).toHaveBeenCalledTimes(1);
  });

  it('a refused submission ends the loop', async () => {
    const h = harness();
    h.talk.start();
    h.spoken();
    await h.hear('I will send all ten parcels.');
    await h.settle(false);
    expect(h.talk.state).toMatchObject({ phase: 'ended', end: 'rejected' });
  });

  it('leaves with a reason when the microphone or recognition is unavailable', async () => {
    const noMic = harness({ canRecord: false });
    noMic.talk.start();
    expect(noMic.talk.state).toMatchObject({ phase: 'ended', end: 'microphone' });
    expect(noMic.out.speak).not.toHaveBeenCalled();

    const noRecognition = harness({ canTranscribe: false });
    noRecognition.talk.start();
    expect(noRecognition.talk.state).toMatchObject({ phase: 'ended', end: 'recognition' });

    const denied = harness();
    denied.talk.start();
    denied.spoken();
    denied.talk.captureFailed();
    expect(denied.talk.state).toMatchObject({ phase: 'ended', end: 'microphone' });

    const broken = harness();
    broken.talk.start();
    broken.spoken();
    broken.talk.captureRecording();
    broken.talk.captureFailed();
    expect(broken.talk.state).toMatchObject({ phase: 'ended', end: 'failed' });

    const refused = harness();
    refused.talk.start();
    refused.spoken();
    await refused.hear('', { transcriptionFailed: true, recognitionError: 'not-allowed' });
    expect(refused.talk.state).toMatchObject({ phase: 'ended', end: 'recognition' });
    expect(refused.submit).not.toHaveBeenCalled();
  });

  it('can be started again after it ended', () => {
    const h = harness();
    h.talk.start();
    h.talk.stop();
    h.talk.reset();
    expect(h.talk.state.phase).toBe('idle');
    h.talk.start();
    expect(h.talk.state.phase).toBe('speaking');
    expect(h.out.speak).toHaveBeenCalledTimes(2);
  });

  it('never speaks while listening or listens while speaking across a whole loop', async () => {
    const h = harness();
    const steps: TalkStep[] = [
      { kind: 'clarify', itemId: 'J1', field: 'action', prompt: 'J1?', key: '2' },
      { kind: 'confirm', prompt: 'Say confirm.', key: '3' },
      { kind: 'done', prompt: 'Done.', key: '4' },
    ];
    h.submit.mockImplementation(async () => {
      h.setStep(steps.shift()!);
      return true;
    });
    h.confirm.mockImplementation(() => {
      h.setStep(steps.shift()!);
      return true;
    });
    h.talk.start();
    h.spoken();
    await h.hear('I will send all ten parcels.');
    h.spoken();
    await h.hear('I will hold J1 until the address is confirmed.');
    h.spoken();
    await h.hear('confirm');
    h.spoken();
    expect(h.talk.state).toMatchObject({ phase: 'ended', end: 'complete' });
    expect(h.events.filter((event) => event.startsWith('ERROR'))).toEqual([]);
    expect(
      h.snapshots.map((snapshot) => snapshot.phase).filter((p, i, all) => p !== all[i - 1]),
    ).toEqual([
      'idle',
      'speaking',
      'listening',
      'checking',
      'speaking',
      'listening',
      'checking',
      'speaking',
      'listening',
      'checking',
      'speaking',
      'ended',
    ]);
  });
});
