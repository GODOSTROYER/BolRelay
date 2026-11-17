import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createHandover } from '../src/domain/engine';
import type { HandoverState } from '../src/domain/types';

const storageKey = 'bolrelay.workspace.v1';
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), storageKey);

function backupFixture() {
  const first = createHandover({
    id: 'recovered-pune-station',
    title: 'Recovered Pune packing station',
    outgoingName: 'Mira',
    incomingName: 'Isha',
    participantLanguages: { outgoing: 'mr-IN', incoming: 'hi-IN' },
    items: [
      {
        id: 'P7',
        label: 'Pune parcels',
        aliases: ['Pune'],
        quantity: 5,
        unit: 'parcel',
        action: 'dispatch',
        notBefore: '09:00',
        condition: null,
        owner: null,
      },
    ],
  });
  const second = createHandover({
    id: 'recovered-mehta-hold',
    title: 'Recovered Mehta hold',
    items: [
      {
        id: 'P8',
        label: 'Mehta parcels',
        aliases: ['Mehta'],
        quantity: 3,
        unit: 'parcel',
        action: 'hold',
        notBefore: null,
        condition: 'address confirmed',
        owner: null,
      },
    ],
  });
  return { version: 1, handovers: [first, second], activeId: first.id };
}

async function chooseBackup(page: Page, content: string) {
  await page.getByLabel('Restore workspace backup file', { exact: true }).setInputFiles({
    name: 'workspace-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dispatch handover', exact: true })).toBeVisible();
  await expect.poll(() => stored(page)).not.toBeNull();
});

test('downloads the actual saved workspace as a restorable backup', async ({ page }) => {
  const original = await stored(page);
  await page.getByRole('button', { name: 'Settings & privacy', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up saved workspace', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('bolrelay-workspace-backup.json');
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, 'utf8')).toBe(original);
  expect(await stored(page)).toBe(original);
});

test('previewing and cancelling a backup never replaces current work', async ({ page }) => {
  const original = await stored(page);
  await chooseBackup(page, JSON.stringify(backupFixture()));
  const dialog = page.getByRole('dialog', { name: 'Restore this workspace backup?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('2 validated handovers', { exact: true })).toBeVisible();
  expect(await stored(page)).toBe(original);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await stored(page)).toBe(original);
  await expect(page.getByRole('heading', { name: 'Dispatch handover', exact: true })).toBeVisible();
});

test('explicit restore replaces the entire workspace and preserves participant languages after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const backup = backupFixture();
  await chooseBackup(page, JSON.stringify(backup));
  await expect(
    page.getByRole('dialog', { name: 'Restore this workspace backup?', exact: true }),
  ).toBeVisible();
  await page.getByTestId('confirm-workspace-restore').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: backup.handovers[0]!.title, exact: true }),
  ).toBeVisible();
  await expect.poll(async () => JSON.parse((await stored(page))!).activeId).toBe(backup.activeId);
  const restored = JSON.parse((await stored(page))!) as {
    handovers: HandoverState[];
    activeId: string;
  };
  expect(restored.handovers.map((state) => state.id)).toEqual(
    backup.handovers.map((state) => state.id),
  );
  expect(restored.handovers[0]?.participantLanguages).toEqual({
    outgoing: 'mr-IN',
    incoming: 'hi-IN',
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: backup.handovers[0]!.title, exact: true }),
  ).toBeVisible();
  const afterReload = JSON.parse((await stored(page))!) as typeof restored;
  expect(afterReload.handovers).toEqual(restored.handovers);
  expect(afterReload.activeId).toBe(backup.activeId);
  expect(errors).toEqual([]);
});

for (const invalidKind of ['malformed JSON', 'inconsistent source evidence']) {
  test(`rejects ${invalidKind} without overwriting saved work`, async ({ page }) => {
    const original = await stored(page);
    const invalid = backupFixture();
    invalid.handovers[0]!.items[0]!.evidence = [
      { utteranceId: 'missing-recording', start: 0, end: 4, text: 'fake' },
    ];
    await chooseBackup(
      page,
      invalidKind === 'malformed JSON' ? '{ unfinished' : JSON.stringify(invalid),
    );
    await expect(
      page.getByRole('alert').filter({ hasText: /not a valid BolRelay workspace backup/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Restore this workspace backup?', exact: true }),
    ).toHaveCount(0);
    expect(await stored(page)).toBe(original);
    await expect(
      page.getByRole('heading', { name: 'Dispatch handover', exact: true }),
    ).toBeVisible();
  });
}
