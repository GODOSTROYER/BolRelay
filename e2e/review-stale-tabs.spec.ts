import { expect, test, type Page } from '@playwright/test';
import { createDemoHandover } from '../src/domain/fixtures';

const storageKey = 'bolrelay.workspace.v1';
const correctReadback =
  'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.';

interface StoredWorkspace {
  activeId: string;
  writeCount?: number;
  handovers: { id: string; confirmations: Record<string, unknown> }[];
}

const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as StoredWorkspace, storageKey);
const staleNotice = (page: Page) => page.getByTestId('stale-workspace-notice');
const toast = (page: Page) => page.locator('.toast');

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
}

async function confirmAll(page: Page) {
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
    await page.getByTestId(`confirm-${id}`).click();
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
}

test('resetting unreadable data in a second tab never wipes the first tab’s newer work', async ({
  context,
}) => {
  const seed = await context.newPage();
  await seed.goto('/');
  await seed.evaluate((key) => localStorage.setItem(key, '{corrupt'), storageKey);
  await seed.close();
  const tabA = await context.newPage();
  await open(tabA);
  const tabB = await context.newPage();
  await open(tabB);
  await expect(tabA.getByTestId('storage-warning')).toBeVisible();
  await expect(tabB.getByTestId('storage-warning')).toBeVisible();

  await tabA.bringToFront();
  await tabA.getByTestId('reset-storage').click();
  await tabA.getByRole('button', { name: 'Reset and save current workspace' }).click();
  await tabA.getByTestId('incoming-transcript').fill(correctReadback);
  await tabA.getByTestId('check-readback').click();
  await confirmAll(tabA);
  const work = await stored(tabA);
  expect(Object.keys(work.handovers[0]!.confirmations).sort()).toEqual(['J1', 'J2', 'NAGPUR']);

  // Tab B still shows the old unreadable warning and resets too.
  await tabB.bringToFront();
  const typed = 'Text typed in tab B before resetting';
  await tabB.getByTestId('incoming-transcript').fill(typed);
  await tabB.getByTestId('reset-storage').click();
  await tabB.getByRole('button', { name: 'Reset and save current workspace' }).click();
  // Nothing is reset; tab B is sent down the reload path instead.
  await expect(staleNotice(tabB)).toBeVisible();
  expect(await stored(tabB)).toEqual(work);
  await tabB.getByTestId('reload-workspace').click();
  await expect(tabB.getByTestId('item-NAGPUR')).toHaveAttribute('data-confirmed', 'true');
  await expect(tabB.getByTestId('storage-warning')).toHaveCount(0);
  await expect(tabB.getByTestId('incoming-transcript')).toHaveValue(typed);
  expect(await stored(tabB)).toEqual(work);

  // Tab B continues from the latest work; tab A becomes stale rather than colliding.
  await tabB.getByTestId('load-demo').click();
  await expect.poll(async () => (await stored(tabB)).handovers.length).toBe(2);
  await tabA.bringToFront();
  await expect(staleNotice(tabA)).toBeVisible();
});

test('a stale tab reports refused new handovers instead of success', async ({ context }) => {
  const tabA = await context.newPage();
  await open(tabA);
  const tabB = await context.newPage();
  await open(tabB);
  await tabB.getByTestId('load-demo').click();
  await expect(staleNotice(tabA)).toBeVisible();
  const newer = await stored(tabB);

  await tabA.bringToFront();
  await tabA.getByTestId('load-demo').click();
  await expect(staleNotice(tabA)).toBeVisible();
  await expect(toast(tabA)).toHaveCount(0);
  await expect(tabA.locator('.handover-nav button')).toHaveCount(1);

  await tabA.getByLabel('Import handover file', { exact: true }).setInputFiles({
    name: 'fresh-handover.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'bolrelay-handover',
        version: 1,
        handover: { ...createDemoHandover(), id: 'imported-handover' },
      }),
    ),
  });
  await expect(toast(tabA)).toHaveCount(0);
  await expect(tabA.locator('.handover-nav button')).toHaveCount(1);
  expect(await stored(tabA)).toEqual(newer);
});

test('reload latest keeps typed text when the handover was deleted in another tab', async ({
  context,
}) => {
  const tabA = await context.newPage();
  await open(tabA);
  await tabA.getByTestId('load-demo').click();
  await expect(tabA.locator('.handover-nav button')).toHaveCount(2);
  const tabB = await context.newPage();
  await open(tabB);
  const typed = 'I will send eight Nagpur parcels after 3 pm. TYPED IN TAB A';
  await tabA.bringToFront();
  await tabA.getByTestId('incoming-transcript').fill(typed);

  await tabB.bringToFront();
  await tabB.getByRole('button', { name: 'Settings & privacy' }).click();
  await tabB.getByRole('button', { name: 'Delete this handover' }).click();
  await tabB.locator('.modal-actions .danger-button').click();
  await expect(tabB.locator('.handover-nav button')).toHaveCount(1);

  await tabA.bringToFront();
  await expect(staleNotice(tabA)).toBeVisible();
  await tabA.getByTestId('reload-workspace').click();
  await expect(staleNotice(tabA)).toHaveCount(0);
  await expect(tabA.locator('.handover-nav button')).toHaveCount(1);
  await expect(tabA.getByTestId('incoming-transcript')).toHaveValue(typed);
  await expect(toast(tabA)).toContainText('another tab deleted or replaced it');
});
