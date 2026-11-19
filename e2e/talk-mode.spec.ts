import { expect, test, type Page } from '@playwright/test';
import { DEMO_TRANSCRIPTS } from '../src/domain/fixtures';

/**
 * Hands-free talk mode at a phone viewport. Speech synthesis, speech recognition,
 * getUserMedia and MediaRecorder are controlled browser doubles: these tests check the
 * app's loop (what it says, when it listens, what it submits), not real microphones,
 * voices or recognition quality.
 */

interface MockOptions {
  /** Voices offered by speechSynthesis. */
  voices?: { lang: string; name: string }[];
  /** Utterances end on their own shortly after starting. */
  autoEnd?: boolean;
  denyMicrophone?: boolean;
}

type TalkTestWindow = Window & {
  talkTest: {
    spoken: string[];
    log: string[];
    say(text: string): void;
    recognitions(): number;
    cancels(): number;
  };
};

async function installMocks(page: Page, options: MockOptions = {}) {
  await page.addInitScript((options: MockOptions) => {
    const log: string[] = [];
    const spoken: string[] = [];
    let cancels = 0;
    let speaking: { onend?: (() => void) | null } | null = null;
    let listening = false;
    class Utterance {
      text: string;
      lang = '';
      rate = 1;
      voice: unknown = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const voices = (options.voices ?? []).map((voice) => ({
      ...voice,
      localService: true,
      default: false,
      voiceURI: voice.name,
    }));
    const synthesis = {
      get speaking() {
        return !!speaking;
      },
      pending: false,
      paused: false,
      getVoices: () => voices,
      speak(utterance: Utterance) {
        if (listening) log.push('ERROR:spoke-while-listening');
        spoken.push(utterance.text);
        log.push('speak');
        speaking = utterance;
        setTimeout(() => {
          if (speaking !== utterance) return;
          utterance.onstart?.();
          if (options.autoEnd !== false)
            setTimeout(() => {
              if (speaking !== utterance) return;
              speaking = null;
              log.push('spoken');
              utterance.onend?.();
            }, 40);
        }, 10);
      },
      cancel() {
        cancels += 1;
        if (speaking) log.push('speech-cancelled');
        speaking = null;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: Utterance,
    });

    const silence = () => {
      const samples = 320;
      const buffer = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buffer);
      const write = (offset: number, text: string) =>
        [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
      write(0, 'RIFF');
      view.setUint32(4, 36 + samples * 2, true);
      write(8, 'WAVE');
      write(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16_000, true);
      view.setUint32(28, 32_000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, samples * 2, true);
      return new Blob([buffer], { type: 'audio/wav' });
    };
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/wav';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        if (speaking) log.push('ERROR:listened-while-speaking');
        this.state = 'recording';
        listening = true;
        log.push('record');
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        listening = false;
        log.push('record-stop');
        setTimeout(() => {
          this.ondataavailable?.({ data: silence() });
          this.onstop?.();
        }, 20);
      }
    }
    const recognitions: Recognition[] = [];
    class Recognition {
      lang = '';
      continuous = false;
      interimResults = false;
      ended = false;
      onresult:
        | ((event: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      start() {
        recognitions.push(this);
        log.push('recognize:' + this.lang);
      }
      stop() {
        setTimeout(() => {
          if (this.ended) return;
          this.ended = true;
          this.onend?.();
        }, 20);
      }
      abort() {
        this.ended = true;
        listening = false;
        log.push('recognition-aborted');
      }
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (options.denyMicrophone)
            throw new DOMException('Permission denied', 'NotAllowedError');
          return {
            getTracks: () => [
              {
                stop() {
                  listening = false;
                },
              },
            ],
          };
        },
      },
    });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    Object.assign(window, {
      talkTest: {
        spoken,
        log,
        recognitions: () => recognitions.length,
        cancels: () => cancels,
        say(text: string) {
          const recognition = recognitions.at(-1);
          if (!recognition || recognition.ended) throw new Error('Not listening');
          log.push('heard:' + text);
          recognition.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: text } }],
          });
        },
      },
    });
  }, options);
}

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as TalkTestWindow).talkTest.spoken.slice());
const log = (page: Page) =>
  page.evaluate(() => (window as unknown as TalkTestWindow).talkTest.log.slice());
const recognitions = (page: Page) =>
  page.evaluate(() => (window as unknown as TalkTestWindow).talkTest.recognitions());

/** Wait until the app is listening on a new recognition session, then speak into it. */
async function answer(page: Page, text: string, session: number) {
  await expect.poll(() => recognitions(page)).toBe(session);
  await expect(page.getByTestId('talk-overlay')).toHaveAttribute('data-phase', 'listening');
  await expect(page.getByTestId('talk-done-speaking')).toBeEnabled();
  await page.evaluate((words) => (window as unknown as TalkTestWindow).talkTest.say(words), text);
  await expect(page.getByTestId('talk-heard')).toContainText(text);
}

async function createHandover(page: Page, instruction: string, language?: string) {
  await page.goto('/');
  await page.getByTestId('new-handover').click();
  if (language)
    await page
      .getByRole('group', { name: 'Handover language' })
      .getByRole('button', { name: language, exact: true })
      .click();
  await page.getByTestId('new-spoken-instructions').fill(instruction);
  await page.getByTestId('review-new-instructions').click();
  await page.getByTestId('attest-new-instructions').check();
  await page.getByTestId('create-spoken-handover').click();
  await expect(page.getByTestId('recipient-guide')).toBeVisible();
}

const englishInstruction =
  'Send three Pune parcels after 4 pm. Hold one parcel J7 until the address is confirmed.';
const englishReadback =
  'I will send three Pune parcels after 4 pm. I will hold one parcel J7 until the address is confirmed.';

test.describe('talk mode at a phone viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Hindi: spoken questions, heard answers, bare हाँ does not confirm, पक्का confirms', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const hi = DEMO_TRANSCRIPTS['hi-IN'];
    await installMocks(page, { voices: [{ lang: 'hi-IN', name: 'Hindi test voice' }] });
    await createHandover(page, hi.outgoing, 'हिन्दी');
    const overlay = page.getByTestId('talk-overlay');
    const prompt = page.getByTestId('talk-prompt');

    await page.getByTestId('talk-start').tap();
    await expect(overlay).toBeVisible();
    // 1. The instruction to say the plan back, without the plan itself.
    await expect.poll(() => spoken(page)).toEqual(['अपने शब्दों में बताइए, हर सामान के साथ आप क्या करेंगे।']);
    await expect(prompt).toHaveText('अपने शब्दों में बताइए, हर सामान के साथ आप क्या करेंगे।');
    await expect(prompt).toHaveAttribute('aria-live', 'polite');
    // 2. The mistaken read-back: all ten parcels.
    await answer(page, hi.mistaken, 1);
    // 3. One targeted question about the held parcels, never their expected values.
    await expect
      .poll(async () => (await spoken(page)).at(-1))
      .toBe('जोशी. क्या करेंगे, और उससे पहले क्या होना ज़रूरी है?');
    // 4. The corrected answer for that item.
    await answer(page, hi.joshiCorrection, 2);
    // 5. Everything matches: the plan is read back and an explicit confirmation is asked.
    await expect.poll(async () => (await spoken(page)).at(-1)).toMatch(/^आपने बताया: .*पक्का/);
    const plan = (await spoken(page)).at(-1)!;
    expect(plan).toContain('नागपुर: 8 पार्सल');
    expect(plan).toContain('जोशी: 2 पार्सल');
    await expect(page.getByTestId('talk-confirm')).toBeVisible();
    // 6. A bare "हाँ" is not a confirmation: it is checked as a new read-back.
    await answer(page, 'हाँ', 3);
    await expect.poll(async () => (await spoken(page)).length).toBe(4);
    const afterBare = (await spoken(page)).at(-1)!;
    expect(afterBare).not.toMatch(/^आपने बताया/);
    expect(afterBare).not.toBe('योजना की पुष्टि हो गई');
    let state = await page.evaluate(() => localStorage.getItem('bolrelay.workspace.v1') ?? '');
    expect(state).not.toContain('"item-confirmed"');
    // The worker restates the plan, answering each question that follows.
    let session = 4;
    for (let turn = 0; turn < 4; turn += 1) {
      const last = (await spoken(page)).at(-1)!;
      if (last.startsWith('आपने बताया')) break;
      await answer(
        page,
        last.startsWith('नागपुर')
          ? 'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'
          : last.startsWith('जोशी')
            ? hi.joshiCorrection
            : hi.corrected,
        session++,
      );
      await expect.poll(async () => (await spoken(page)).length).toBe(4 + turn + 1);
    }
    await expect.poll(async () => (await spoken(page)).at(-1)).toMatch(/^आपने बताया: /);
    // 7. The explicit confirm phrase confirms every matching item.
    await answer(page, 'पक्का', session);
    await expect.poll(async () => (await spoken(page)).at(-1)).toBe('योजना की पुष्टि हो गई');
    await expect(overlay).toHaveAttribute('data-phase', 'ended');
    await page.getByTestId('talk-close').tap();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId('recipient-guide')).toHaveClass(/is-complete/);

    // Nothing was typed, and no prompt before the confirmation revealed a value.
    await expect(page.getByTestId('incoming-transcript')).toHaveValue('');
    const prompts = await spoken(page);
    const firstConfirm = prompts.findIndex((text) => text.startsWith('आपने बताया'));
    for (const text of prompts.slice(0, firstConfirm)) expect(text).not.toMatch(/8|आठ|15:00|2 /);
    // It never spoke while listening, nor listened while speaking.
    expect((await log(page)).filter((entry) => entry.startsWith('ERROR'))).toEqual([]);
    expect((await log(page)).filter((entry) => entry.startsWith('recognize:'))[0]).toBe(
      'recognize:hi-IN',
    );
    // The heard words were stored as read-backs, attached to their recordings.
    state = await page.evaluate(() => localStorage.getItem('bolrelay.workspace.v1') ?? '');
    for (const words of [hi.mistaken, hi.joshiCorrection, '"text":"हाँ"'])
      expect(state).toContain(words);
    // The confirm phrase confirmed; it was not stored as a read-back.
    expect(state).not.toContain('"text":"पक्का"');
    expect(state).toContain('"item-confirmed"');
    await page.getByRole('button', { name: 'Open navigation' }).tap();
    await page.getByRole('button', { name: 'Activity', exact: true }).tap();
    const source = page.locator('.transcript-archive details').filter({ hasText: hi.mistaken });
    await source.locator('summary').tap();
    await expect(source.getByLabel('Play original recording', { exact: true })).toHaveAttribute(
      'src',
      /^blob:/,
    );
    expect(errors).toEqual([]);
  });

  test('a declined microphone leaves talk mode with a clear message', async ({ page }) => {
    await installMocks(page, {
      voices: [{ lang: 'en-IN', name: 'English test voice' }],
      denyMicrophone: true,
    });
    await createHandover(page, englishInstruction);
    await page.getByTestId('talk-start').tap();
    await expect(page.getByTestId('talk-overlay')).toBeVisible();
    await expect(page.getByTestId('talk-overlay')).toHaveCount(0);
    await expect(page.getByTestId('talk-notice')).toHaveText(/Talk mode needs the microphone/);
    await expect(page.getByTestId('talk-start')).toBeEnabled();
    await expect(page.getByTestId('incoming-transcript')).toBeVisible();
    await expect(page.getByTestId('recipient-guide')).toBeVisible();
  });

  test('without a matching voice the prompts are shown and the loop still completes', async ({
    page,
  }) => {
    await installMocks(page, { voices: [] });
    await createHandover(page, englishInstruction);
    await page.getByTestId('talk-start').tap();
    await expect(page.getByTestId('talk-no-voice')).toBeVisible();
    await expect(page.getByTestId('talk-prompt')).toHaveText(
      'Tell me in your own words what you will do with each item.',
    );
    await answer(page, englishReadback, 1);
    await expect(page.getByTestId('talk-prompt')).toContainText('You said:');
    await expect(page.getByTestId('talk-prompt')).toContainText('say “confirm”');
    await answer(page, 'confirm', 2);
    await expect(page.getByTestId('talk-prompt')).toHaveText('The handover is confirmed');
    await expect(page.getByTestId('talk-no-voice')).toHaveCount(1);
    expect(await spoken(page)).toEqual([]);
    await page.getByTestId('talk-close').tap();
    await expect(page.getByTestId('recipient-guide')).toHaveClass(/is-complete/);
  });

  test('Stop cancels speech and capture, and nothing late is submitted', async ({ page }) => {
    await installMocks(page, {
      voices: [{ lang: 'en-IN', name: 'English test voice' }],
      autoEnd: false,
    });
    await createHandover(page, englishInstruction);
    await page.getByTestId('talk-start').tap();
    await expect(page.getByTestId('talk-overlay')).toHaveAttribute('data-phase', 'speaking');
    await expect.poll(() => spoken(page)).toHaveLength(1);
    await page.getByTestId('talk-stop').tap();
    await expect(page.getByTestId('talk-overlay')).toHaveCount(0);
    expect(await log(page)).toContain('speech-cancelled');
    // The speech watchdog of the cancelled turn never starts listening.
    await page.waitForTimeout(6_000);
    expect(await recognitions(page)).toBe(0);
    await expect(page.getByTestId('talk-start')).toBeFocused();
  });

  test('Stop while listening aborts the capture; its words are never checked', async ({ page }) => {
    await installMocks(page, { voices: [{ lang: 'en-IN', name: 'English test voice' }] });
    await createHandover(page, englishInstruction);
    await page.getByTestId('talk-start').tap();
    await expect.poll(() => recognitions(page)).toBe(1);
    await expect(page.getByTestId('talk-done-speaking')).toBeEnabled();
    await page.getByTestId('talk-stop').tap();
    await expect(page.getByTestId('talk-overlay')).toHaveCount(0);
    expect(await log(page)).toContain('recognition-aborted');
    await page.waitForTimeout(2_500);
    const incoming = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('bolrelay.workspace.v1') ?? '{}') as {
        activeId: string;
        handovers: { id: string; utterances: { role: string }[] }[];
      };
      return saved.handovers
        .find((handover) => handover.id === saved.activeId)!
        .utterances.filter((utterance) => utterance.role === 'incoming').length;
    });
    expect(incoming).toBe(0);
    await expect(page.getByTestId('recipient-guide').locator('h2')).toHaveText(
      'Listen to the instructions, then say your next actions in your own words.',
    );
  });
});
