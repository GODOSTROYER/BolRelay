import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parseTranscript } from '../src/domain/parser';
import type { ParseTranscriptInput } from '../src/domain/types';
import { createDemoHandover } from '../src/domain/fixtures';

const correctReadback =
  'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.';

async function enterReadback(page: Page, text: string) {
  await page.getByTestId('incoming-transcript').fill(text);
  await page.getByTestId('check-readback').click();
}

async function confirmCurrentItems(page: Page) {
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
    await page.getByTestId(`confirm-${id}`).click();
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/BolRelay/i);
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
});

test('catches the two held parcels, repairs the readback, and confirms current instructions', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  await enterReadback(page, 'I will send all ten parcels after three.');

  await expect(page.getByTestId('item-NAGPUR')).toHaveAttribute('data-status', 'agreement');
  for (const id of ['J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'contradiction');
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'false');
    await expect(page.getByTestId(`confirm-${id}`)).toBeDisabled();
  }

  await enterReadback(page, correctReadback);
  await confirmCurrentItems(page);
  expect(uncaught).toEqual([]);
});

test('reports an omitted group without turning it into an explicit contradiction', async ({
  page,
}) => {
  // The landing example already contains a mistaken read-back. Import a fresh
  // synthetic board through the real import control to test first-time omission.
  await page.getByLabel('Import handover file', { exact: true }).setInputFiles({
    name: 'fresh-handover.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ format: 'bolrelay-handover', version: 1, handover: createDemoHandover() }),
    ),
  });
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'omission');
  await enterReadback(page, 'I will send eight Nagpur parcels after 3 pm.');
  await expect(page.getByTestId('item-NAGPUR')).toHaveAttribute('data-status', 'agreement');
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'omission');
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-status', 'omission');
});

test('accepts the supported timing paraphrase and reordered clauses', async ({ page }) => {
  await enterReadback(
    page,
    'I will hold two Joshi parcels until the address is confirmed. I will send eight Nagpur parcels once it is past three.',
  );
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
  }
});

test('releasing J1 invalidates only its confirmation and preserves the J2 hold', async ({
  page,
}) => {
  await enterReadback(page, correctReadback);
  await confirmCurrentItems(page);

  await page.getByTestId('release-J1').click();
  await page.getByTestId('confirm-release').click();

  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-revision', '2');
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-confirmed', 'false');
  await expect(page.getByTestId('confirm-J1')).toBeDisabled();
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-revision', '1');
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-confirmed', 'true');
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-action', 'hold');
  await expect(page.getByTestId('item-NAGPUR')).toHaveAttribute('data-confirmed', 'true');
});

test('persists the current handover and confirmations after a reload', async ({ page }) => {
  await enterReadback(page, correctReadback);
  await confirmCurrentItems(page);
  await page.reload();
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
});

test('reapplying unchanged outgoing text preserves current confirmations and keeps the source history', async ({
  page,
}) => {
  await enterReadback(page, correctReadback);
  await confirmCurrentItems(page);
  const countOutgoing = () =>
    page.evaluate(() => {
      const workspace = JSON.parse(localStorage.getItem('bolrelay.workspace.v1')!);
      return workspace.handovers
        .find((handover: { id: string }) => handover.id === workspace.activeId)
        .utterances.filter((utterance: { role: string }) => utterance.role === 'outgoing')
        .length as number;
    });
  const before = await countOutgoing();
  await page.getByRole('tab', { name: 'Outgoing instructions', exact: true }).click();
  await page
    .getByTestId('outgoing-transcript')
    .fill(
      'Send eight Nagpur parcels after 3 pm. Hold two Joshi parcels until the address is confirmed.',
    );
  await page.getByTestId('review-instructions').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Apply reviewed instructions', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-revision', '1');
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
  await expect.poll(countOutgoing).toBe(before + 1);
});

test('exports the current structured state with revisions and evidence', async ({ page }) => {
  await enterReadback(page, correctReadback);
  await confirmCurrentItems(page);
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('export-handover').click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.json$/i);
  const path = await file.path();
  expect(path).not.toBeNull();
  const exported: unknown = JSON.parse(await readFile(path!, 'utf8'));
  const envelope = exported as Record<string, unknown>;
  const state = (envelope.handover ?? envelope) as {
    schemaVersion: number;
    items: { id: string; revision: number }[];
    confirmations: Record<string, { itemRevision: number }>;
    utterances: { text: string }[];
  };
  expect(state.schemaVersion).toBe(1);
  expect(state.items.map((item) => item.id).sort()).toEqual(['J1', 'J2', 'NAGPUR']);
  expect(state.confirmations.J1.itemRevision).toBe(1);
  expect(state.utterances.some((utterance) => utterance.text === correctReadback)).toBe(true);
  expect(JSON.stringify(exported)).not.toMatch(/api[_-]?key|bearer\s+[A-Za-z0-9]/i);
});

test('the mobile primary workflow remains usable without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
  await enterReadback(page, 'I will send all ten parcels after three.');
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'contradiction');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('creates and checks a custom handover rather than only the seeded example', async ({
  page,
}) => {
  await page.getByTestId('new-handover').click();
  await page.getByLabel('Handover name', { exact: true }).fill('Evening dispatch');
  await page.getByLabel('Outgoing person', { exact: true }).fill('Meena');
  await page.getByLabel('Incoming person', { exact: true }).fill('Farida');
  await page.getByLabel('Item name 1', { exact: true }).fill('Kolhapur');
  await page.getByLabel('Quantity 1', { exact: true }).fill('4');
  await page.getByLabel('Not before 1', { exact: true }).fill('17:00');
  await page.getByTestId('create-handover').click();
  await expect(page.getByRole('heading', { name: 'Evening dispatch', exact: true })).toBeVisible();
  await enterReadback(page, 'I will send four Kolhapur parcels after 5 pm.');
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-status', 'agreement');
  await page.getByTestId('confirm-ITEM1').click();
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-confirmed', 'true');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Evening dispatch', exact: true })).toBeVisible();
  await expect(page.getByTestId('item-ITEM1')).toHaveAttribute('data-confirmed', 'true');
});

test('preserves malformed saved data and exposes deliberate recovery', async ({ page }) => {
  const original = '{malformed workspace: original';
  await page.evaluate((value) => localStorage.setItem('bolrelay.workspace.v1', value), original);
  await page.reload();
  await expect(page.getByTestId('storage-warning')).toBeVisible();
  await expect(page.getByTestId('reset-storage')).toBeVisible();
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('bolrelay.workspace.v1'))).toBe(original);
});

test('keeps the typed workflow available when microphone permission is denied (mocked denial)', async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Permission denied in synthetic test', 'NotAllowedError');
      },
    });
  });
  await page.getByRole('button', { name: 'Record voice', exact: true }).click();
  await expect(page.getByText(/Microphone access was declined/)).toBeVisible();
  await enterReadback(page, correctReadback);
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
  }
});

test('does not apply a delayed outgoing interpretation to a different handover (mocked model)', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        modelConfigured: true,
        modelName: 'Synthetic test adapter',
        requiresToken: true,
      }),
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Settings & privacy', exact: true }).click();
  await page.getByRole('radio', { name: /Model-assisted extraction/ }).check();
  await page
    .getByLabel('Application access token', { exact: true })
    .fill('synthetic-test-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/analyze', async (route) => {
    const input = route.request().postDataJSON() as ParseTranscriptInput;
    const parsed = { ...parseTranscript(input), parser: 'model' };
    started();
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(parsed) });
  });

  try {
    const previousId = await page.evaluate(
      () => JSON.parse(localStorage.getItem('bolrelay.workspace.v1')!).activeId as string,
    );
    await page.getByRole('tab', { name: 'Outgoing instructions', exact: true }).click();
    await page.getByTestId('outgoing-transcript').fill('Send nine Nagpur parcels after 3 pm.');
    await page.getByTestId('review-instructions').click();
    await requestStarted;
    await page.getByTestId('load-demo').click();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('bolrelay.workspace.v1')!).activeId as string,
        ),
      )
      .not.toBe(previousId);
    release();
    await expect(page.getByTestId('check-readback')).toBeEnabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('item-NAGPUR')).toHaveAttribute('data-revision', '1');
    await expect(page.getByTestId('item-NAGPUR')).toContainText('8 parcels');
  } finally {
    release();
  }
});
