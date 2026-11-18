import { expect, test, type Page } from '@playwright/test';

const storageKey = 'bolrelay.workspace.v1';
const correctReadback =
  'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.';

interface StoredWorkspace {
  activeId: string;
  writeCount?: number;
  handovers: {
    id: string;
    title: string;
    items: { id: string; revision: number; action: string }[];
    confirmations: Record<string, { itemRevision: number } | undefined>;
  }[];
}

const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as StoredWorkspace, storageKey);
const activeStored = async (page: Page) => {
  const workspace = await stored(page);
  return workspace.handovers.find((handover) => handover.id === workspace.activeId)!;
};

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
    .not.toBeNull();
}

async function enterReadback(page: Page, text: string) {
  await page.getByTestId('incoming-transcript').fill(text);
  await page.getByTestId('check-readback').click();
}

async function confirmAll(page: Page) {
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
    await page.getByTestId(`confirm-${id}`).click();
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
}

const staleNotice = (page: Page) => page.getByTestId('stale-workspace-notice');

test('a stale tab cannot overwrite confirmations saved by a newer tab', async ({ context }) => {
  const tabA = await context.newPage();
  await open(tabA);
  const tabB = await context.newPage();
  await open(tabB);
  // Merely opening a second tab must not make the first one stale.
  await expect(staleNotice(tabA)).toHaveCount(0);

  await tabB.bringToFront();
  await enterReadback(tabB, correctReadback);
  await confirmAll(tabB);
  const newer = await stored(tabB);
  expect(Object.keys((await activeStored(tabB)).confirmations).sort()).toEqual([
    'J1',
    'J2',
    'NAGPUR',
  ]);

  // Tab A still shows the older mistaken read-back. Any change there is refused.
  await tabA.bringToFront();
  const intent = 'I will send all ten parcels after 3 PM. Typed in the stale tab.';
  await enterReadback(tabA, intent);
  await expect(staleNotice(tabA)).toBeVisible();
  await expect(staleNotice(tabA)).toContainText('changed in another tab');
  await expect(staleNotice(tabA)).toHaveAttribute('role', 'alert');
  // The newer saved workspace is untouched and the user's typed intent is still visible.
  expect(await stored(tabA)).toEqual(newer);
  await expect(tabA.getByTestId('incoming-transcript')).toHaveValue(intent);

  await tabA.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(staleNotice(tabA)).toHaveCount(0);
  for (const id of ['NAGPUR', 'J1', 'J2'])
    await expect(tabA.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  await expect(tabA.getByTestId('incoming-transcript')).toHaveValue(intent);
  expect(await stored(tabA)).toEqual(newer);
});

test('a confirmation from a stale view never applies to a newer revision', async ({ context }) => {
  const tabA = await context.newPage();
  await open(tabA);
  await enterReadback(tabA, correctReadback);
  await expect(tabA.getByTestId('item-J1')).toHaveAttribute('data-status', 'agreement');

  const tabB = await context.newPage();
  await open(tabB);
  await expect(tabB.getByTestId('item-J1')).toHaveAttribute('data-status', 'agreement');
  await tabB.getByTestId('release-J1').click();
  await tabB.getByTestId('confirm-release').click();
  await expect(tabB.getByTestId('item-J1')).toHaveAttribute('data-revision', '2');
  const newer = await stored(tabB);

  // Tab A still displays revision 1 of J1 as agreeing; confirming it must be refused.
  await tabA.bringToFront();
  await expect(tabA.getByTestId('item-J1')).toHaveAttribute('data-revision', '1');
  await tabA.getByTestId('confirm-J1').click();
  await expect(staleNotice(tabA)).toBeVisible();
  await expect(tabA.getByTestId('item-J1')).toHaveAttribute('data-confirmed', 'false');
  expect(await stored(tabA)).toEqual(newer);
  const j1 = (await activeStored(tabA)).items.find((item) => item.id === 'J1')!;
  expect(j1.revision).toBe(2);
  expect((await activeStored(tabA)).confirmations.J1).toBeUndefined();

  await tabA.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(tabA.getByTestId('item-J1')).toHaveAttribute('data-revision', '2');
  await expect(tabA.getByTestId('item-J1')).toHaveAttribute('data-confirmed', 'false');
  await expect(tabA.getByTestId('confirm-J1')).toBeDisabled();
});

test('a stale tab learns about newer work through storage events and blocks new handovers', async ({
  context,
}) => {
  const tabA = await context.newPage();
  await open(tabA);
  const tabB = await context.newPage();
  await open(tabB);
  await tabB.getByTestId('load-demo').click();
  await expect.poll(async () => (await stored(tabB)).handovers.length).toBe(2);
  const newer = await stored(tabB);

  // No interaction in tab A: the storage event alone surfaces the notice.
  await expect(staleNotice(tabA)).toBeVisible();
  await tabA.getByTestId('load-demo').click();
  expect(await stored(tabA)).toEqual(newer);
  await tabA.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(tabA.locator('.handover-nav button')).toHaveCount(2);

  // After reloading, tab A is current again and its edits make tab B stale instead.
  await enterReadback(tabA, correctReadback);
  await expect(tabA.getByTestId('item-J1')).toHaveAttribute('data-status', 'agreement');
  await expect(staleNotice(tabA)).toHaveCount(0);
  await expect(staleNotice(tabB)).toBeVisible();
});

test('restoring a backup in one tab invalidates the other tab', async ({ context }) => {
  const tabA = await context.newPage();
  await open(tabA);
  const tabB = await context.newPage();
  await open(tabB);
  const backup = await tabB.evaluate((key) => localStorage.getItem(key)!, storageKey);
  await tabB.getByLabel('Restore workspace backup file', { exact: true }).setInputFiles({
    name: 'workspace-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await tabB.getByTestId('confirm-workspace-restore').click();
  await expect(tabB.getByRole('dialog')).toHaveCount(0);
  await expect(staleNotice(tabB)).toHaveCount(0);
  await expect(staleNotice(tabA)).toBeVisible();
});

test('saved data from before the write counter is migrated without a false conflict', async ({
  context,
}) => {
  const tabA = await context.newPage();
  await open(tabA);
  await tabA.evaluate((key) => {
    const legacy = JSON.parse(localStorage.getItem(key)!);
    delete legacy.writeCount;
    localStorage.setItem(key, JSON.stringify(legacy));
  }, storageKey);
  // Simulate data written by an older build before this tab or any other loaded it.
  await tabA.reload();
  await expect(tabA.getByTestId('incoming-transcript')).toBeVisible();
  await enterReadback(tabA, correctReadback);
  await confirmAll(tabA);
  await expect(staleNotice(tabA)).toHaveCount(0);
  expect((await stored(tabA)).writeCount).toBeGreaterThan(0);
  expect(Object.keys((await activeStored(tabA)).confirmations)).toHaveLength(3);
});
