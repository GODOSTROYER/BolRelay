import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Walks the guided recipient flow at phone viewports and measures, for each
// step, whether the current question and its primary action are on screen
// without scrolling, how far the user would have to scroll, whether anything
// covers them, and where keyboard focus lands after each transition.
// Set MOBILE_EVIDENCE_DIR to write the measurements and viewport screenshots.

const instruction =
  'Send three Pune parcels after 4 pm. Hold one parcel J7 until the address is confirmed.';
const evidenceDir = process.env.MOBILE_EVIDENCE_DIR;

interface Box {
  top: number;
  bottom: number;
  inView: boolean;
  covered: boolean;
}
interface Measurement {
  step: string;
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
  overflowX: number;
  targets: Record<string, Box>;
  /** Both the question and the primary action are fully visible and uncovered. */
  visible: boolean;
  /** Pixels the user must scroll (either direction) to see question and action together. */
  scrollNeeded: number;
  /** The question and action cannot be shown on one screen at all. */
  fits: boolean;
  focus: string;
  focusInView: boolean;
}

async function measure(
  page: Page,
  step: string,
  question: Locator,
  action: Locator,
): Promise<Measurement> {
  await page.evaluate(() => document.fonts.ready);
  // Let any smooth scroll triggered by the transition settle before measuring.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1;
        let still = 0;
        const tick = () => {
          still = window.scrollY === last ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 5) resolve();
          else requestAnimationFrame(tick);
        };
        setTimeout(tick, 50);
      }),
  );
  const boxes: Record<string, Box> = {};
  for (const [name, locator] of [
    ['question', question],
    ['action', action],
  ] as const) {
    await expect(locator).toBeVisible();
    boxes[name] = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const height = window.innerHeight;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const points = [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2]
        .filter((y) => y >= 0 && y < height)
        .map((y) => document.elementFromPoint(x, y));
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        inView: rect.top >= 0 && rect.bottom <= height,
        covered: points.some((hit) => !hit || !(element === hit || element.contains(hit))),
      };
    });
  }
  const page_ = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const rect = active?.getBoundingClientRect();
    const label = !active
      ? 'none'
      : active === document.body
        ? 'body'
        : `${active.tagName.toLowerCase()}${active.dataset.testid ? `[${active.dataset.testid}]` : ''}${active.id ? `#${active.id}` : ''} "${(active.textContent ?? '').trim().slice(0, 40)}"`;
    return {
      scrollY: Math.round(window.scrollY),
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      focus: label,
      focusInView:
        !!rect && active !== document.body && rect.bottom > 0 && rect.top < window.innerHeight,
    };
  });
  const top = Math.min(boxes.question!.top, boxes.action!.top);
  const bottom = Math.max(boxes.question!.bottom, boxes.action!.bottom);
  const height = page_.viewportHeight;
  const scrollNeeded = top < 0 ? -top : bottom > height ? bottom - height : 0;
  return {
    step,
    ...page_,
    targets: boxes,
    visible:
      boxes.question!.inView &&
      boxes.action!.inView &&
      !boxes.question!.covered &&
      !boxes.action!.covered,
    scrollNeeded,
    fits: bottom - top <= height,
  };
}

async function snap(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, name), animations: 'disabled' });
}

async function record(
  page: Page,
  results: Measurement[],
  label: string,
  step: string,
  question: Locator,
  action: Locator,
) {
  const result = await measure(page, step, question, action);
  results.push(result);
  await snap(page, `${label}-${String(results.length).padStart(2, '0')}-${step}.png`);
  return result;
}

function report(testInfo: TestInfo, label: string, results: Measurement[]) {
  const lines = results.map(
    (entry) =>
      `${label} ${entry.step.padEnd(22)} visible=${entry.visible ? 'yes' : 'NO '} scroll=${String(entry.scrollNeeded).padStart(4)}px fits=${entry.fits ? 'y' : 'n'} y=${entry.scrollY} doc=${entry.documentHeight} focus=${entry.focus}`,
  );
  console.log(lines.join('\n'));
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, `${label}.json`), JSON.stringify(results, null, 2));
  }
  return testInfo.attach(`${label}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
}

const viewports = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 320, height: 740 },
];

for (const viewport of viewports) {
  test.describe(`mobile recipient ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

    test('guided read-back, clarification, confirmation and change receipt stay in view', async ({
      page,
    }, testInfo) => {
      const label = `${viewport.width}x${viewport.height}`;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const results: Measurement[] = [];
      const guide = page.getByTestId('recipient-guide');
      const heading = guide.locator('h2');
      const transcript = page.getByTestId('incoming-transcript');
      const check = page.getByTestId('check-readback');

      await page.goto('/');
      await page.getByTestId('new-handover').click();
      await page.getByTestId('new-spoken-instructions').fill(instruction);
      await page.getByTestId('review-new-instructions').click();
      await page.getByTestId('attest-new-instructions').check();
      await page.getByTestId('create-spoken-handover').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(guide).toBeVisible();

      // 1. Guided view opens: the prompt and the way to hear the instruction.
      await record(page, results, label, 'open', heading, page.getByTestId('listen-current-plan'));
      // 2. Read the instruction instead of listening.
      const readable = page.getByTestId('read-current-instructions');
      await readable.locator('summary').tap();
      await expect(readable).toHaveAttribute('open', '');
      await record(page, results, label, 'read-instructions', readable.locator('li').last(), check);
      await readable.locator('summary').tap();
      // 3. Type the read-back: the prompt, the field and the submit action.
      await transcript.fill('I will send all four parcels after 4 pm.');
      await record(page, results, label, 'type-readback', transcript, check);
      // 4. Submit and see the clarification question.
      await check.tap();
      await expect(page.getByTestId('guide-clarify')).toBeVisible();
      await record(
        page,
        results,
        label,
        'clarification',
        guide.locator('.guide-question'),
        page.getByTestId('guide-clarify'),
      );
      // 5. Answer the clarification: the question stays visible beside the field.
      const target = (await guide.locator('.guide-current strong').first().textContent())!.trim();
      await page.getByTestId('guide-clarify').tap();
      await expect(transcript).toBeFocused();
      await transcript.fill(
        target === 'J7'
          ? 'I will hold one parcel J7 until the address is confirmed.'
          : 'I will send three Pune parcels after 4 pm.',
      );
      await record(page, results, label, 'answer', guide.locator('.guide-question'), check);
      await check.tap();
      // 6. Confirm each matched item until the handover is complete.
      for (let index = 0; index < 4; index += 1) {
        const confirm = page.getByTestId('guide-confirm');
        const clarify = page.getByTestId('guide-clarify');
        await expect(confirm.or(clarify)).toBeVisible();
        if (await clarify.isVisible()) {
          const next = (await guide.locator('.guide-current strong').first().textContent())!.trim();
          await record(
            page,
            results,
            label,
            `clarification-${next}`,
            guide.locator('.guide-question'),
            clarify,
          );
          await clarify.tap();
          await transcript.fill(
            next === 'J7'
              ? 'I will hold one parcel J7 until the address is confirmed.'
              : 'I will send three Pune parcels after 4 pm.',
          );
          await check.tap();
          continue;
        }
        await record(page, results, label, `confirm-${index + 1}`, heading, confirm);
        await confirm.tap();
        if (await guide.evaluate((element) => element.classList.contains('is-complete'))) break;
      }
      await expect(guide).toHaveClass(/is-complete/);
      await record(page, results, label, 'complete', heading, heading);

      // 7. The instruction changes: the before/after receipt and repair.
      await page.getByTestId('full-view').tap();
      await page.getByTestId('release-J7').tap();
      await page.getByTestId('confirm-release').tap();
      await expect(page.getByTestId('item-J7')).toHaveAttribute('data-revision', '2');
      await page.getByTestId('guided-view').tap();
      await expect(page.getByTestId('change-receipt')).toBeVisible();
      await record(
        page,
        results,
        label,
        'change-receipt',
        page.getByTestId('change-receipt'),
        page.getByTestId('guide-clarify'),
      );
      await page.getByTestId('guide-clarify').tap();
      await transcript.fill('I will send one parcel J7.');
      await record(page, results, label, 'change-answer', guide.locator('.guide-question'), check);
      await check.tap();
      await expect(page.getByTestId('guide-confirm')).toBeVisible();
      await record(
        page,
        results,
        label,
        'change-confirm',
        heading,
        page.getByTestId('guide-confirm'),
      );
      await page.getByTestId('guide-confirm').tap();
      await expect(guide).toHaveClass(/is-complete/);
      await record(page, results, label, 'change-complete', heading, heading);

      await report(testInfo, label, results);
      expect(errors).toEqual([]);
      for (const entry of results) {
        expect(entry.overflowX, entry.step).toBeLessThanOrEqual(1);
        expect(entry.visible, `${entry.step}: question and action on screen`).toBe(true);
        // After each result the worker lands on the new step, not the composer.
        if (/^(clarification|confirm|complete|change-confirm|change-complete)/.test(entry.step))
          expect(entry.focus, entry.step).toMatch(/^h2 /);
        if (/answer$/.test(entry.step))
          expect(entry.focus, entry.step).toContain('incoming-transcript');
      }
    });
  });
}

for (const language of [
  {
    code: 'hi-IN',
    label: 'हिन्दी',
    instruction: 'पाँच पुणे पार्सल शाम चार बजे के बाद भेजना। दो जोशी पार्सल पता कन्फर्म होने तक रोक कर रखना।',
    readback: 'मैं पाँच पुणे पार्सल शाम चार बजे के बाद भेजूंगा।',
  },
  {
    code: 'mr-IN',
    label: 'मराठी',
    instruction: 'पाच पुणे पार्सल दुपारी चार नंतर पाठवा. पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवा.',
    readback: 'मी पाच पुणे पार्सल दुपारी चार नंतर पाठवेन.',
  },
] as const) {
  test.describe(`mobile recipient ${language.code} 320x740`, () => {
    test.use({
      viewport: { width: 320, height: 740 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });

    test('native-script clarification stays readable and in view', async ({ page }, testInfo) => {
      const label = `${language.code}-320x740`;
      const results: Measurement[] = [];
      const guide = page.getByTestId('recipient-guide');
      const transcript = page.getByTestId('incoming-transcript');
      const check = page.getByTestId('check-readback');
      await page.goto('/');
      await page.getByTestId('new-handover').click();
      await page
        .getByRole('group', { name: 'Handover language' })
        .getByRole('button', { name: language.label, exact: true })
        .click();
      await page.getByTestId('new-spoken-instructions').fill(language.instruction);
      await page.getByTestId('review-new-instructions').click();
      await page.getByTestId('attest-new-instructions').check();
      await page.getByTestId('create-spoken-handover').click();
      await expect(guide).toBeVisible();
      await record(
        page,
        results,
        label,
        'open',
        guide.locator('h2'),
        page.getByTestId('listen-current-plan'),
      );
      await transcript.fill(language.readback);
      await record(page, results, label, 'type-readback', transcript, check);
      await check.tap();
      await expect(page.getByTestId('guide-clarify')).toBeVisible();
      await record(
        page,
        results,
        label,
        'clarification',
        guide.locator('.guide-question'),
        page.getByTestId('guide-clarify'),
      );
      await page.getByTestId('guide-clarify').tap();
      await expect(transcript).toBeFocused();
      await record(page, results, label, 'answer', guide.locator('.guide-question'), check);
      await report(testInfo, label, results);
      for (const entry of results) {
        expect(entry.overflowX, entry.step).toBeLessThanOrEqual(1);
        expect(entry.visible, `${entry.step}: question and action on screen`).toBe(true);
      }
      expect(results.find((entry) => entry.step === 'clarification')!.focus).toMatch(/^h2 /);
      // Devanagari question text wraps inside the card rather than clipping.
      expect(
        await guide
          .locator('.guide-question')
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
    });
  });
}
