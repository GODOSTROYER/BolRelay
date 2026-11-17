import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { HandoverState } from '../src/domain/types';

const instruction =
  'Send three Pune parcels after 4 pm. Hold one parcel J7 until the address is confirmed.';
const correct =
  'I will send three Pune parcels after 4 pm. I will hold one parcel J7 until the address is confirmed.';

async function openDraft(page: Page, text = instruction) {
  await page.getByTestId('new-handover').click();
  await page.getByTestId('new-spoken-instructions').fill(text);
  await page.getByTestId('review-new-instructions').click();
}
async function createFromReviewedDraft(page: Page) {
  await expect(page.getByTestId('spoken-draft-preview')).toBeVisible();
  await expect(page.getByTestId('create-spoken-handover')).toBeDisabled();
  await page.getByTestId('attest-new-instructions').check();
  await page.getByTestId('create-spoken-handover').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('recipient-guide')).toBeVisible();
}
async function readback(page: Page, text: string) {
  await page.getByTestId('incoming-transcript').fill(text);
  await page.getByTestId('check-readback').click();
}
async function activeState(page: Page): Promise<HandoverState> {
  return page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('bolrelay.workspace.v1')!);
    return workspace.handovers.find((state: { id: string }) => state.id === workspace.activeId);
  });
}
async function screenshot(page: Page, testInfo: TestInfo, name: string, fullPage: boolean) {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  return errors;
}

test('typed transcript creates fresh reviewed items and supports distinct full and targeted rechecks', async ({
  page,
}) => {
  await page.goto('/');
  await openDraft(page);
  await expect(page.getByTestId('spoken-draft-preview')).toContainText('Pune');
  await expect(page.getByTestId('spoken-draft-preview')).toContainText('J7');
  await createFromReviewedDraft(page);
  const created = await activeState(page);
  expect(
    created.items.map(({ id, label, quantity, action, notBefore, condition }) => ({
      id,
      label,
      quantity,
      action,
      notBefore,
      condition,
    })),
  ).toEqual([
    {
      id: 'ITEM1',
      label: 'Pune',
      quantity: 3,
      action: 'dispatch',
      notBefore: '16:00',
      condition: null,
    },
    {
      id: 'J7',
      label: 'J7',
      quantity: 1,
      action: 'hold',
      notBefore: null,
      condition: 'address confirmed',
    },
  ]);
  expect(created.utterances).toHaveLength(1);
  expect(created.utterances[0].text).toBe(instruction);
  expect(created.utterances[0].role).toBe('outgoing');

  await readback(page, correct);
  await page.getByTestId('guide-confirm').click();
  await page.getByTestId('guide-confirm').click();
  await expect(page.getByTestId('recipient-guide')).toHaveClass(/is-complete/);

  await page.getByTestId('full-view').click();
  await readback(page, 'I will send three Pune parcels after 4 pm.');
  await expect(page.getByTestId('item-J7')).toHaveAttribute('data-status', 'omission');
  await expect(page.getByTestId('item-J7')).toHaveAttribute('data-confirmed', 'false');
  await page.getByTestId('confirm-ITEM1').click();
  await page.getByTestId('clarify-J7').click();
  await readback(page, 'I will hold one parcel J7 until the address is confirmed.');
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-confirmed', 'true');
  await expect(page.getByTestId('item-J7')).toHaveAttribute('data-status', 'agreement');
  await page.getByTestId('confirm-J7').click();

  await page.getByTestId('release-J7').click();
  await page.getByTestId('confirm-release').click();
  await expect(page.getByTestId('item-J7')).toHaveAttribute('data-revision', '2');
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-confirmed', 'true');
  await page.getByTestId('guided-view').click();
  await expect(page.getByTestId('change-receipt')).toBeVisible();
  await page.getByTestId('guide-clarify').click();
  await readback(page, 'I will send one parcel J7.');
  await page.getByTestId('guide-confirm').click();
  await expect(page.getByTestId('recipient-guide')).toHaveClass(/is-complete/);
});

test('typed ambiguous or conflicting creation stays unresolved and cannot be promoted', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('new-handover').click();
  for (const text of [
    'Send five Pune parcels after three.',
    'Hold two Joshi parcels.',
    'Hold two Joshi parcels until the address is confirmed and release them now.',
  ]) {
    await page.getByTestId('new-spoken-instructions').fill(text);
    await page.getByTestId('review-new-instructions').click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('spoken-draft-preview')).toHaveCount(0);
    await expect(page.getByTestId('create-spoken-handover')).toHaveCount(0);
  }
});

for (const language of [
  {
    code: 'hi-IN',
    label: 'हिन्दी',
    otherCode: 'mr-IN',
    otherLabel: 'मराठी',
    transcript: 'पाँच पुणे पार्सल शाम चार बजे के बाद भेजना। दो जोशी पार्सल पता कन्फर्म होने तक रोक कर रखना।',
    question: 'निर्देश सुनें, फिर अपने शब्दों में बताएं कि आगे क्या करेंगे।',
  },
  {
    code: 'mr-IN',
    label: 'मराठी',
    otherCode: 'hi-IN',
    otherLabel: 'हिन्दी',
    transcript: 'पाच पुणे पार्सल दुपारी चार नंतर पाठवा. पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवा.',
    question: 'सूचना ऐका आणि स्वतःच्या शब्दांत पुढचे काम सांगा.',
  },
] as const) {
  test(
    'typed ' + language.code + ' draft and separate participant languages persist after reload',
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await page.getByTestId('new-handover').click();
      await page
        .getByRole('group', { name: 'Handover language' })
        .getByRole('button', { name: language.label, exact: true })
        .click();
      await page.getByTestId('new-spoken-instructions').fill(language.transcript);
      await page.getByTestId('review-new-instructions').click();
      await createFromReviewedDraft(page);
      await expect(page.getByTestId('recipient-guide')).toContainText(language.question);
      expect((await activeState(page)).participantLanguages).toEqual({
        outgoing: language.code,
        incoming: language.code,
      });

      await page.getByRole('tablist', { name: 'Participant' }).getByRole('tab').first().click();
      await page.locator('.language-control > button').click();
      await page.getByRole('option', { name: language.otherLabel, exact: true }).click();
      expect((await activeState(page)).participantLanguages).toEqual({
        outgoing: language.otherCode,
        incoming: language.code,
      });
      await page.getByRole('tablist', { name: 'Participant' }).getByRole('tab').nth(1).click();
      await expect(page.locator('.language-control > button')).toHaveText(language.label);
      await page.reload();
      await expect(page.getByTestId('recipient-guide')).toContainText(language.question);
      await expect(page.locator('.language-control > button')).toHaveText(language.label);
      await page.evaluate(() => window.scrollTo(0, 0));
      await screenshot(page, testInfo, 'recipient-' + language.code + '-390x844.png', true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.getByRole('tablist', { name: 'Participant' }).getByRole('tab').first().click();
      await expect(page.locator('.language-control > button')).toHaveText(language.otherLabel);
    },
  );
}

for (const viewport of [
  { width: 1536, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(
    'typed spoken-draft and guided repair visual evidence ' +
      viewport.width +
      'x' +
      viewport.height,
    async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const errors = watchErrors(page);
      await page.goto('/');
      await expect(page).toHaveTitle(/BolRelay/);
      await openDraft(page);
      await expect(page.getByTestId('spoken-draft-preview')).toBeVisible();
      await expect(page.getByTestId('create-spoken-handover')).toBeDisabled();
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await screenshot(
        page,
        testInfo,
        'draft-review-' + viewport.width + 'x' + viewport.height + '.png',
        false,
      );
      await createFromReviewedDraft(page);
      await readback(page, 'I will send all four parcels after 4 pm.');
      await expect(page.getByTestId('recipient-guide')).toContainText('J7');
      await expect(page.getByTestId('guide-clarify')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await screenshot(
        page,
        testInfo,
        'guided-repair-' + viewport.width + 'x' + viewport.height + '.png',
        viewport.width < 600,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      expect(errors).toEqual([]);
    },
  );
}
