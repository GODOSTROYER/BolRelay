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
/** Open the guide's clarification for the current item and give a short answer. */
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
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('a short count answers the quantity question; bare replies are reworded, then escalated', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await createBoard(page);
  await readback(
    page,
    'I will send Pune parcels after 4 pm. I will hold one parcel J7 until the address is confirmed.',
  );
  const guide = page.getByTestId('recipient-guide');
  const question = guide.locator('.guide-question');
  await expect(question).toHaveText('Pune. How many, and in which unit?');
  await expect(question).toHaveAttribute('data-attempts', '0');

  // A bare reply never fills the count and the same wording is not repeated.
  await clarify(page, 'yes');
  await expect(question).toHaveAttribute('data-attempts', '1');
  await expect(question).not.toHaveText('Pune. How many, and in which unit?');
  await expect(question).toContainText('cannot answer this');
  await expect(question).toContainText('Say just the number');
  await expect(page.getByTestId('guide-confirm')).toHaveCount(0);
  await expect(page.getByTestId('clarification-escape')).toHaveCount(0);

  await clarify(page, 'हाँ');
  await clarify(page, 'ok');
  await expect(question).toHaveAttribute('data-attempts', '3');
  await expect(page.getByTestId('clarification-escape')).toContainText('Ask the sender');
  await expect(page.getByTestId('guide-review-board')).toBeVisible();
  await expect(page.getByTestId('guide-confirm')).toHaveCount(0);
  const unresolved = await activeState(page);
  const pune = unresolved.readbacks.ITEM1!.claims[0]!;
  expect(pune.quantity).toBeUndefined();
  expect(pune).toMatchObject({ action: 'dispatch', notBefore: '16:00' });

  // The worker can still answer with just the number.
  await clarify(page, 'three');
  await expect(page.getByTestId('guide-confirm')).toContainText('Pune');
  await expect(page.getByTestId('clarification-escape')).toHaveCount(0);
  const answered = await activeState(page);
  expect(answered.readbacks.ITEM1!.claims[0]).toMatchObject({
    action: 'dispatch',
    quantity: 3,
    unit: 'parcel',
    notBefore: '16:00',
    evidence: { text: 'three' },
    basis: { fields: ['quantity'] },
  });
  await page.getByTestId('guide-confirm').click();
  await page.getByTestId('guide-confirm').click();
  await expect(guide).toHaveClass(/is-complete/);
  expect(errors).toEqual([]);
});

test('an escalated clarification offers the full board for review', async ({ page }) => {
  await createBoard(page);
  await readback(
    page,
    'I will send Pune parcels after 4 pm. I will hold one parcel J7 until the address is confirmed.',
  );
  for (const text of ['yes', 'ok', 'हो']) await clarify(page, text);
  await page.getByTestId('guide-review-board').click();
  await expect(page.getByTestId('recipient-guide')).toHaveCount(0);
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-status', 'uncertainty');
});

test('time answers need AM/PM, and a contradicting short answer stays a contradiction', async ({
  page,
}) => {
  await createBoard(page);
  await readback(
    page,
    'I will send three Pune parcels. I will hold one parcel J7 until the address is confirmed.',
  );
  const question = page.getByTestId('recipient-guide').locator('.guide-question');
  await expect(question).toContainText('At what time may this start?');

  await clarify(page, '4 बजे के बाद');
  await expect(question).toHaveAttribute('data-attempts', '1');
  await expect(question).toContainText('with AM or PM');
  expect((await activeState(page)).readbacks.ITEM1!.claims[0]!.notBefore).toBeUndefined();

  await clarify(page, 'after 2 pm');
  await page.getByTestId('full-view').click();
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-status', 'contradiction');
  await page.getByTestId('guided-view').click();

  await clarify(page, 'शाम 4 बजे के बाद');
  await expect(page.getByTestId('guide-confirm')).toContainText('Pune');
  expect((await activeState(page)).readbacks.ITEM1!.claims[0]).toMatchObject({
    quantity: 3,
    notBefore: '16:00',
  });
});
