import { expect, test } from '@playwright/test';

/**
 * Controlled browser media events exercise the rendered capture/submission flow.
 * The generated silent WAV is a fixture, not microphone or ASR quality evidence.
 */
test('mocked capture waits for final audio and speech, then preserves the same recording after reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    class Recorder {
      static instances: Recorder[] = [];
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/wav';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        Recorder.instances.push(this);
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
      }
    }
    class Recognition {
      static instances: Recognition[] = [];
      lang = '';
      continuous = false;
      interimResults = false;
      onresult:
        | ((event: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor() {
        Recognition.instances.push(this);
      }
      start() {}
      stop() {}
      abort() {}
    }
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
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    const control = {
      words(text: string) {
        Recognition.instances.at(-1)?.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        });
      },
      audioFinished() {
        const recorder = Recorder.instances.at(-1)!;
        recorder.ondataavailable?.({ data: silence() });
        recorder.onstop?.();
      },
      speechFinished() {
        Recognition.instances.at(-1)?.onend?.();
      },
    };
    Object.assign(window, { bolrelayCaptureTest: control });
  });

  await page.goto('/');
  await page
    .getByTestId('incoming-transcript')
    .fill('Previous text must not become the new recording.');
  await page.getByTestId('record-voice').click();
  await expect(page.getByTestId('incoming-transcript')).toHaveValue('');
  const transcript =
    'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.';
  await page.evaluate((words) => {
    const control = (window as unknown as { bolrelayCaptureTest: { words(text: string): void } })
      .bolrelayCaptureTest;
    control.words(words);
  }, transcript);
  await page.getByTestId('record-voice').click();
  await expect(page.getByTestId('capture-status')).toBeVisible();
  await expect(page.getByTestId('check-readback')).toBeDisabled();
  await expect(page.getByTestId('record-voice')).toBeDisabled();

  await page.evaluate(() =>
    (
      window as unknown as { bolrelayCaptureTest: { audioFinished(): void } }
    ).bolrelayCaptureTest.audioFinished(),
  );
  await expect(page.getByTestId('check-readback')).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { bolrelayCaptureTest: { speechFinished(): void } }
    ).bolrelayCaptureTest.speechFinished(),
  );
  await expect(page.getByTestId('incoming-transcript')).toHaveValue(transcript);
  await expect(page.getByTestId('check-readback')).toBeEnabled();
  await expect(page.getByLabel('Latest recording', { exact: true })).toHaveAttribute(
    'src',
    /^blob:/,
  );

  await page.getByTestId('check-readback').click();
  for (const id of ['NAGPUR', 'J1', 'J2'])
    await expect(page.getByTestId('item-' + id)).toHaveAttribute('data-status', 'agreement');
  // The visible comparison precedes the asynchronous IndexedDB write.
  await expect(page.getByTestId('check-readback')).toBeEnabled();

  await page.reload();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const source = page.locator('.transcript-archive details').filter({ hasText: transcript });
  await source.locator('summary').click();
  const recording = source.getByLabel('Play original recording', { exact: true });
  await expect(recording).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => recording.evaluate((element) => (element as HTMLAudioElement).readyState))
    .toBeGreaterThan(0);
});
