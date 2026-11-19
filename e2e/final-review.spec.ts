import { expect, test, type Page } from '@playwright/test';

const storageKey = 'bolrelay.workspace.v1';
const correctReadback =
  'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.';

interface StoredWorkspace {
  writeCount?: number;
  handovers: {
    id: string;
    title: string;
    items: { id: string; quantity: number }[];
    confirmations: Record<string, unknown>;
  }[];
}
const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as StoredWorkspace, storageKey);
const staleNotice = (page: Page) => page.getByTestId('stale-workspace-notice');
const dialogStale = (page: Page) => page.getByRole('dialog').getByTestId('dialog-stale-notice');

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
    .not.toBeNull();
}

/** Two tabs; tab B then saves new work, so tab A becomes stale. */
async function staleTabs(context: import('@playwright/test').BrowserContext) {
  const tabA = await context.newPage();
  await open(tabA);
  const tabB = await context.newPage();
  await open(tabB);
  return { tabA, tabB, makeStale: () => tabB.getByTestId('load-demo').click() };
}

/** Saved confirmed work whose stored reading needs a recheck under the current rules. */
async function seedRecheckData(page: Page) {
  await open(page);
  await page.getByTestId('incoming-transcript').fill(correctReadback);
  await page.getByTestId('check-readback').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await page.getByTestId(`confirm-${id}`).click();
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
  await page.evaluate((key) => {
    type Evidence = { text: string; start: number; end: number };
    const workspace = JSON.parse(localStorage.getItem(key)!);
    const handover = workspace.handovers[0];
    const utterance = handover.utterances.at(-1);
    const patch = (text: string) => text.replace('eight Nagpur', 'thirty eight Nagpur');
    const old = utterance.text as string;
    utterance.text = patch(old);
    const shift = utterance.text.length - old.length;
    const fix = (part: { evidence: Evidence }) => {
      const evidence = part.evidence;
      if (evidence.text.includes('eight Nagpur')) {
        evidence.text = patch(evidence.text);
        evidence.end += shift;
      } else if (evidence.start > 0) {
        evidence.start += shift;
        evidence.end += shift;
      }
    };
    for (const claim of utterance.claims) fix(claim);
    for (const issue of utterance.issues) fix(issue);
    for (const readback of Object.values<{
      claims: { evidence: Evidence }[];
      issues: { evidence: Evidence }[];
    }>(handover.readbacks)) {
      for (const claim of readback.claims) fix(claim);
      for (const issue of readback.issues) fix(issue);
    }
    delete utterance.rulesVersion;
    localStorage.setItem(key, JSON.stringify(workspace));
  }, storageKey);
  await page.close();
}

test.describe('final review N1/N7: a recheck never makes other tabs stale', () => {
  test('opening a second tab after a recheck does not pause the first', async ({ context }) => {
    await seedRecheckData(await context.newPage());
    const tabA = await context.newPage();
    await open(tabA);
    await expect(tabA.getByTestId('legacy-recheck-notice')).toBeVisible();
    const before = (await stored(tabA)).writeCount;
    await tabA.getByTestId('incoming-transcript').fill('TYPING IN A');

    const tabB = await context.newPage();
    await open(tabB);
    await expect(tabB.getByTestId('legacy-recheck-notice')).toBeVisible();
    const tabC = await context.newPage();
    await open(tabC);
    await tabC.waitForTimeout(300);
    expect((await stored(tabC)).writeCount).toBe(before);
    for (const tab of [tabA, tabB, tabC]) await expect(staleNotice(tab)).toHaveCount(0);
    await expect(tabA.getByTestId('incoming-transcript')).toHaveValue('TYPING IN A');
  });

  test('two tabs opened together on data needing a recheck both stay usable', async ({
    context,
  }) => {
    await seedRecheckData(await context.newPage());
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await Promise.all([tabA.goto('/'), tabB.goto('/')]);
    for (const tab of [tabA, tabB]) {
      await expect(tab.getByTestId('incoming-transcript')).toBeVisible();
      await expect(tab.getByTestId('legacy-recheck-notice')).toBeVisible();
    }
    await tabA.waitForTimeout(500);
    for (const tab of [tabA, tabB]) {
      await expect(staleNotice(tab)).toHaveCount(0);
      await expect(tab.getByTestId('storage-warning')).toHaveCount(0);
    }
    // The rechecked confirmation is not restored by either tab.
    expect((await stored(tabA)).handovers[0]!.confirmations.NAGPUR).toBeUndefined();
    // Both tabs can still save: an edit in B then pauses A as usual.
    await tabB.bringToFront();
    await tabB.getByTestId('load-demo').click();
    await expect(tabB.locator('.handover-nav button')).toHaveCount(2);
    await expect(staleNotice(tabB)).toHaveCount(0);
    await expect(staleNotice(tabA)).toBeVisible();
  });
});

test.describe('final review N2: stale-tab dialog actions explain themselves', () => {
  test('item edit: the dialog says why, reloads in place and keeps the typed value', async ({
    context,
  }) => {
    const { tabA, tabB, makeStale } = await staleTabs(context);
    await tabA.bringToFront();
    await tabA.getByTestId('edit-NAGPUR').click();
    const dialog = tabA.getByRole('dialog');
    await dialog.getByRole('spinbutton').first().fill('9');
    await makeStale();
    const newer = await stored(tabB);
    await tabA.getByTestId('save-item').click();
    await expect(dialog).toBeVisible();
    await expect(dialogStale(tabA)).toBeVisible();
    await expect(dialogStale(tabA)).toContainText('nothing in this dialog is saved yet');
    expect(await stored(tabA)).toEqual(newer);

    await dialog.getByTestId('dialog-reload-workspace').click();
    await expect(dialogStale(tabA)).toHaveCount(0);
    await expect(dialog.getByRole('spinbutton').first()).toHaveValue('9');
    await tabA.getByTestId('save-item').click();
    await expect(tabA.getByRole('dialog')).toHaveCount(0);
    const saved = await stored(tabA);
    expect(saved.handovers.length).toBe(2);
    const edited = saved.handovers.find((handover) =>
      handover.items.some((item) => item.id === 'NAGPUR' && item.quantity === 9),
    );
    expect(edited).toBeDefined();
  });

  test('manual new handover: the message is in the dialog and the form survives a reload', async ({
    context,
  }) => {
    const { tabA, makeStale } = await staleTabs(context);
    await tabA.bringToFront();
    await tabA.getByTestId('new-handover').click();
    await tabA.getByRole('button', { name: 'Enter items manually', exact: true }).click();
    await tabA.getByLabel('Handover name', { exact: true }).fill('Night shift');
    await tabA.getByLabel('Outgoing person', { exact: true }).fill('Asha');
    await tabA.getByLabel('Incoming person', { exact: true }).fill('Ravi');
    await tabA.getByLabel('Item name 1', { exact: true }).fill('Pune');
    await tabA.getByLabel('Quantity 1', { exact: true }).fill('3');
    await makeStale();
    await tabA.getByTestId('create-handover').click();
    await expect(dialogStale(tabA)).toBeVisible();
    // The page's own notice is behind the dialog; the dialog's notice is on top.
    const reachable = await tabA.evaluate(() => {
      const notice = document.querySelector('[data-testid="dialog-stale-notice"]')!;
      const box = notice.getBoundingClientRect();
      return notice.contains(document.elementFromPoint(box.left + 30, box.top + 10));
    });
    expect(reachable).toBe(true);
    await tabA.getByTestId('dialog-reload-workspace').click();
    await expect(tabA.getByLabel('Handover name', { exact: true })).toHaveValue('Night shift');
    await expect(tabA.getByLabel('Item name 1', { exact: true })).toHaveValue('Pune');
    await tabA.getByTestId('create-handover').click();
    await expect(tabA.getByRole('heading', { name: 'Night shift', exact: true })).toBeVisible();
    expect((await stored(tabA)).handovers.map((handover) => handover.title)).toContain(
      'Night shift',
    );
  });

  test('when the other tab changed the same item, the dialog shows why saving fails', async ({
    context,
  }) => {
    const { tabA, tabB } = await staleTabs(context);
    await tabA.bringToFront();
    await tabA.getByTestId('edit-NAGPUR').click();
    const dialog = tabA.getByRole('dialog');
    await dialog.getByRole('spinbutton').first().fill('9');
    await tabB.bringToFront();
    await tabB.getByTestId('edit-NAGPUR').click();
    await tabB.getByRole('dialog').getByRole('spinbutton').first().fill('7');
    await tabB.getByTestId('save-item').click();
    await expect(tabB.getByRole('dialog')).toHaveCount(0);
    const newer = await stored(tabB);

    await tabA.bringToFront();
    await tabA.getByTestId('save-item').click();
    await expect(dialogStale(tabA)).toBeVisible();
    await tabA.getByTestId('dialog-reload-workspace').click();
    await tabA.getByTestId('save-item').click();
    await expect(dialog.getByTestId('dialog-error')).toContainText('This instruction has changed');
    await expect(dialog.getByRole('spinbutton').first()).toHaveValue('9');
    expect(await stored(tabA)).toEqual(newer);
  });
});

test.describe('final review N3: typed instructions survive a stale tab', () => {
  const instructions =
    'Send three Pune parcels after 4 pm. Hold one parcel J7 until the address is confirmed.';

  test('reload inside the dialog keeps the draft and creating then works', async ({ context }) => {
    const { tabA, makeStale } = await staleTabs(context);
    await tabA.bringToFront();
    await tabA.getByTestId('new-handover').click();
    await tabA.getByTestId('new-spoken-instructions').fill(instructions);
    await makeStale();
    await tabA.getByTestId('review-new-instructions').click();
    await tabA.getByTestId('attest-new-instructions').check();
    await tabA.getByTestId('create-spoken-handover').click();
    const dialog = tabA.getByRole('dialog');
    await expect(dialog.getByRole('alert').filter({ hasText: 'Not created yet' })).toBeVisible();
    await expect(dialogStale(tabA)).toBeVisible();
    await tabA.getByTestId('dialog-reload-workspace').click();
    await expect(dialogStale(tabA)).toHaveCount(0);
    await tabA.getByTestId('create-spoken-handover').click();
    await expect(tabA.getByRole('dialog')).toHaveCount(0);
    expect((await stored(tabA)).handovers).toHaveLength(3);
  });

  test('closing the dialog, reloading and reopening keeps the typed instructions', async ({
    context,
  }) => {
    const { tabA, makeStale } = await staleTabs(context);
    await tabA.bringToFront();
    await tabA.getByTestId('new-handover').click();
    await tabA.getByTestId('new-spoken-instructions').fill(instructions);
    await makeStale();
    await tabA.getByTestId('review-new-instructions').click();
    await tabA.getByTestId('attest-new-instructions').check();
    await tabA.getByTestId('create-spoken-handover').click();
    await expect(dialogStale(tabA)).toBeVisible();
    await tabA.getByRole('button', { name: 'Close dialog' }).click();
    await tabA.getByTestId('reload-workspace').click();
    await tabA.getByTestId('new-handover').click();
    await expect(tabA.getByTestId('new-spoken-instructions')).toHaveValue(instructions);
  });
});

test('final review N5: restoring a backup over newer work needs an explicit second confirmation', async ({
  context,
}) => {
  const tabA = await context.newPage();
  await open(tabA);
  const backup = await tabA.evaluate((key) => localStorage.getItem(key)!, storageKey);
  const tabB = await context.newPage();
  await open(tabB);
  await tabB.getByTestId('incoming-transcript').fill(correctReadback);
  await tabB.getByTestId('check-readback').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await tabB.getByTestId(`confirm-${id}`).click();
    await expect(tabB.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
  const newer = await stored(tabB);

  await tabA.bringToFront();
  await tabA.getByLabel('Restore workspace backup file', { exact: true }).setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  const warning = tabA.getByTestId('restore-replaces-newer');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('also replaces that newer work');
  await expect(tabA.getByTestId('confirm-workspace-restore')).toBeDisabled();
  expect(await stored(tabA)).toEqual(newer);

  await tabA.getByTestId('confirm-replace-newer').check();
  await tabA.getByTestId('confirm-workspace-restore').click();
  await expect(tabA.getByRole('dialog')).toHaveCount(0);
  expect(Object.keys((await stored(tabA)).handovers[0]!.confirmations)).toEqual([]);
  await expect(staleNotice(tabB)).toBeVisible();
});

test('final review N6: the history limit is named instead of a broken-file message', async ({
  page,
}) => {
  await open(page);
  await page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key)!);
    const handover = workspace.handovers[0];
    while (handover.events.length < 5_000)
      handover.events.push({
        ...handover.events[0],
        id: `filler-${handover.events.length}`,
        type: 'item-confirmed',
        itemIds: [],
        message: 'Filler history entry',
      });
    localStorage.setItem(key, JSON.stringify(workspace));
  }, storageKey);
  await page.reload();
  await page.getByTestId('incoming-transcript').fill(correctReadback);
  await page.getByTestId('check-readback').click();
  const banner = page.locator('.error-banner');
  await expect(banner).toContainText('history limit');
  await expect(banner).toContainText('export this handover');
  await expect(banner).not.toContainText('not a supported');
});

test('final review (a): data corrupted while open offers the reset without a reload', async ({
  page,
}) => {
  await open(page);
  await page.evaluate((key) => localStorage.setItem(key, '{corrupt'), storageKey);
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('storage-warning')).toBeVisible();
  await expect(page.getByTestId('reset-storage')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe('{corrupt');
});

/** Emulates an on-screen keyboard: the visual viewport shrinks, the layout viewport stays. */
const setVisualHeight = (page: Page, height: number) =>
  page.evaluate((visible) => {
    Object.defineProperty(window.visualViewport!, 'height', {
      configurable: true,
      get: () => visible,
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, height);

for (const size of [
  { name: '320x480 with a 300px keyboard', width: 320, height: 480, keyboard: 300 },
  { name: '568x320 with a 160px keyboard', width: 568, height: 320, keyboard: 160 },
]) {
  test.describe(`final review layout: ${size.name}`, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });

    test('the sticky actions never cover the field being typed in', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('new-handover').click();
      await page
        .getByTestId('new-spoken-instructions')
        .fill(
          'Send three Pune parcels after 4 pm. Hold one parcel J7 until the address is confirmed.',
        );
      await page.getByTestId('review-new-instructions').click();
      await page.getByTestId('attest-new-instructions').check();
      await page.getByTestId('create-spoken-handover').click();
      await expect(page.getByTestId('recipient-guide')).toBeVisible();
      await page.getByTestId('incoming-transcript').fill('I will send Pune parcels after 4 pm.');
      await page.getByTestId('check-readback').tap();
      await page.getByTestId('guide-clarify').tap();
      await expect(page.getByTestId('incoming-transcript')).toBeFocused();

      const visible = size.height - size.keyboard;
      await setVisualHeight(page, visible);
      await page.evaluate((height) => {
        const field = document.getElementById('incoming-transcript')!;
        field.blur();
        field.focus();
        // What the browser does on focus: bring the field just above the keyboard.
        const box = field.getBoundingClientRect();
        if (box.bottom > height) window.scrollBy(0, box.bottom - height);
      }, visible);
      await page.waitForTimeout(400);
      const layout = await page.evaluate((height) => {
        const field = document.getElementById('incoming-transcript')!.getBoundingClientRect();
        const check = document
          .querySelector('[data-testid="check-readback"]')!
          .getBoundingClientRect();
        const hit = document.elementFromPoint(field.left + 20, Math.min(field.bottom, height) - 6);
        return {
          inset: getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset'),
          fieldBottom: field.bottom,
          checkTop: check.top,
          bottomLineHit: hit?.id || hit?.className || null,
        };
      }, visible);
      expect(layout.inset).toBe(`${size.keyboard}px`);
      // The last line of the field is the field itself, inside the visible area ...
      expect(layout.bottomLineHit).toBe('incoming-transcript');
      expect(layout.fieldBottom).toBeLessThanOrEqual(visible + 1);
      // ... and Check follows right below it.
      expect(layout.checkTop).toBeGreaterThanOrEqual(layout.fieldBottom - 1);
      expect(layout.checkTop - layout.fieldBottom).toBeLessThan(40);

      // With the keyboard closed again the actions are pinned as before.
      await setVisualHeight(page, size.height);
      await expect
        .poll(() =>
          page.evaluate(
            () => getComputedStyle(document.querySelector('.composer-actions')!).position,
          ),
        )
        .toBe('sticky');
    });
  });
}
