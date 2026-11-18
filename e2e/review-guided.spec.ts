import { expect, test, type Page } from '@playwright/test';
import type { HandoverState } from '../src/domain/types';

const instruction =
  'Send three Pune parcels after 4 pm. Hold one parcel J7 until the address is confirmed.';

async function createBoard(page: Page) {
  await page.goto('/');
  await page.getByTestId('new-handover').click();
  await page.getByTestId('new-spoken-instructions').fill(instruction);
  await page.getByTestId('review-new-instructions').click();
  await page.getByTestId('attest-new-instructions').check();
  await page.getByTestId('create-spoken-handover').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('recipient-guide')).toBeVisible();
}
async function readback(page: Page, text: string) {
  await page.getByTestId('incoming-transcript').fill(text);
  await page.getByTestId('check-readback').click();
}
async function clarify(page: Page, text: string) {
  await page.getByTestId('guide-clarify').click();
  await readback(page, text);
}
async function activeState(page: Page): Promise<HandoverState> {
  return page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('bolrelay.workspace.v1')!);
    return workspace.handovers.find((state: { id: string }) => state.id === workspace.activeId);
  });
}

test.describe('guided view at 320x740', () => {
  test.use({
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });

  test('results, confirmations and reworded questions are announced', async ({ page }) => {
    await createBoard(page);
    const status = page.getByTestId('recipient-guide').getByRole('status').last();
    await expect(page.getByTestId('guide-announcement')).toHaveAttribute('role', 'status');

    await readback(
      page,
      'I will send Pune parcels after 4 pm. I will hold one parcel J7 until the address is confirmed.',
    );
    await expect(status).toHaveText('Pune. How many, and in which unit?');

    await clarify(page, 'ok');
    await expect(status).toContainText('Say just the number');
    const first = await status.textContent();
    await clarify(page, 'yes');
    // The same reworded question is announced again, not silently kept.
    await expect.poll(() => status.textContent()).not.toBe(first);
    await expect(status).toContainText('Say just the number');

    await clarify(page, 'yes, three');
    await expect(status).toContainText('Pune. The stated actions match the plan');
    await page.getByTestId('guide-confirm').click();
    await expect(status).toContainText('Confirmed: Pune.');
    await expect(status).toContainText('Next: J7');
    await page.getByTestId('guide-confirm').click();
    await expect(status).toContainText('Confirmed: J7.');
    await expect(status).toContainText('The handover is confirmed');
  });

  test('the question stays beside the field above a simulated on-screen keyboard', async ({
    page,
  }) => {
    await createBoard(page);
    await readback(page, 'I will send Pune parcels after 4 pm.');
    await page.getByTestId('guide-clarify').tap();
    const field = page.getByTestId('incoming-transcript');
    await expect(field).toBeFocused();
    const question = page.getByTestId('scope-question');
    await expect(question).toHaveText('Pune. How many, and in which unit?');
    await expect(field).toHaveAttribute('aria-describedby', 'incoming-scope-question');

    const keyboard = 300;
    await page.evaluate((inset) => {
      document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
      const transcript = document.getElementById('incoming-transcript')!;
      transcript.blur();
      transcript.focus();
    }, keyboard);
    await page.waitForTimeout(400);
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        question: box('[data-testid="scope-question"]'),
        field: box('#incoming-transcript'),
        bar: box('.composer-actions'),
      };
    });
    const visibleBottom = 740 - keyboard;
    expect(geometry.question.top).toBeGreaterThanOrEqual(0);
    expect(geometry.question.bottom).toBeLessThanOrEqual(visibleBottom);
    expect(geometry.field.top).toBeGreaterThanOrEqual(0);
    // The sticky actions never cover the field being typed in.
    expect(geometry.bar.top).toBeGreaterThanOrEqual(geometry.field.bottom - 1);
    expect(geometry.bar.bottom).toBeLessThanOrEqual(visibleBottom + 1);
  });
});

test('short answers in the guided view never confirm an unstated or misread value', async ({
  page,
}) => {
  await createBoard(page);
  await readback(page, 'I will send Pune parcels after 4 pm. I will hold one parcel J7.');
  const question = page.getByTestId('recipient-guide').locator('.guide-question');
  await expect(question).toHaveText('Pune. How many, and in which unit?');

  // A clock time is not a count; it reopens the time instead.
  await clarify(page, '8 PM');
  await expect(page.getByTestId('guide-confirm')).toHaveCount(0);
  expect((await activeState(page)).readbacks.ITEM1!.claims[0]!.quantity).toBeUndefined();
  await expect(question).toContainText('Say just the earliest start time');
  await clarify(page, 'after 4 pm');
  await expect(question).toContainText('Say just the number');

  // A natural "yes, three" keeps the earlier statement and fills the count.
  await clarify(page, 'yes, three');
  // The guide moves on to the next open item, J7.
  await expect(question).toContainText('J7. What must happen before this can proceed?');
  expect((await activeState(page)).readbacks.ITEM1!.claims[0]).toMatchObject({
    quantity: 3,
    notBefore: '16:00',
  });

  // A negated prerequisite never becomes "until the address is confirmed".
  await clarify(page, "address doesn't need to be confirmed");
  await expect(page.getByTestId('guide-confirm')).toHaveCount(0);
  const state = await activeState(page);
  const j7 = state.readbacks[state.items.find((item) => item.label.includes('J7'))!.id]!.claims[0]!;
  expect(j7.condition).toBeUndefined();
  expect(j7.uncertainFields).toContain('condition');

  await clarify(page, 'until the address is confirmed');
  await expect(page.getByTestId('guide-confirm')).toContainText('Pune');
  await page.getByTestId('guide-confirm').click();
  await expect(page.getByTestId('guide-confirm')).toContainText('J7');
});
