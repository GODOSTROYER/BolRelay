import { expect, test, type Page } from '@playwright/test';
import { DEMO_TRANSCRIPTS } from '../src/domain/fixtures';

const hindi = DEMO_TRANSCRIPTS['hi-IN'];
const marathi = DEMO_TRANSCRIPTS['mr-IN'];
const devanagari = /[ऀ-ॿ]/;

const activeHandover = (page: Page) =>
  page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('bolrelay.workspace.v1')!);
    return workspace.handovers.find(
      (handover: { id: string }) => handover.id === workspace.activeId,
    ) as {
      id: string;
      participantLanguages: Record<string, string>;
      utterances: { role: string; language: string; text: string }[];
    };
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
});

test('a Hindi instruction is checked against a Marathi read-back as one plan', async ({ page }) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  const button = page.getByTestId('load-cross-language-demo');
  await expect(button).toHaveText('Hindi → Marathi example');
  await button.click();
  await expect(page.getByText('Synthetic example · No real parcels or customers.')).toBeVisible();

  // Seeded: Hindi instruction, Marathi incoming worker, mistaken Marathi read-back checked.
  const seeded = await activeHandover(page);
  expect(seeded.participantLanguages).toEqual({ outgoing: 'hi-IN', incoming: 'mr-IN' });
  expect(seeded.utterances.map((utterance) => [utterance.role, utterance.language])).toEqual([
    ['outgoing', 'hi-IN'],
    ['incoming', 'mr-IN'],
  ]);
  expect(seeded.utterances[0]!.text).toBe(hindi.outgoing);
  await expect(page.getByTestId('incoming-transcript')).toHaveValue(marathi.mistaken);

  await expect(page.getByTestId('item-NAGPUR')).toHaveAttribute('data-status', 'agreement');
  for (const id of ['J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'contradiction');
    await expect(page.getByTestId(`confirm-${id}`)).toBeDisabled();
  }

  // The clarification quotes the Hindi instruction and the Marathi words, asked in Marathi.
  const panel = page.locator('.comparison-panel');
  await expect(panel.getByTestId('language-pair-note')).toHaveText(
    'सूचना: हिंदी · उत्तर: मराठी · दोन्ही एकाच योजनेशी पडताळले',
  );
  const card = panel.locator('details.discrepancy').first();
  await expect(card).toContainText('Joshi · J1');
  const quotes = card.locator('.evidence-quote p');
  const source = (await quotes.nth(0).innerText()).trim();
  expect(source.length).toBeGreaterThan(0);
  expect(hindi.outgoing).toContain(source);
  expect(source).toContain('जोशी');
  await expect(quotes.nth(1)).toHaveText(marathi.mistaken.replace(/\.$/, ''));
  const question = (await card.locator('.clarification-question').innerText()).trim();
  expect(question).toMatch(devanagari);

  // The example read-back buttons follow the incoming worker's Marathi.
  await page.getByRole('button', { name: 'A missed hold', exact: true }).click();
  await expect(page.getByTestId('incoming-transcript')).toHaveValue(marathi.mistaken);
  await page.getByRole('button', { name: 'A correct read-back', exact: true }).click();
  await expect(page.getByTestId('incoming-transcript')).toHaveValue(marathi.corrected);
  await page.getByTestId('check-readback').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
  }
  await expect(page.locator('.agreement-panel').getByTestId('language-pair-note')).toBeVisible();

  await page.getByTestId('confirm-handover').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }

  // J1 changes to dispatch; only its confirmation reopens.
  await page.getByTestId('release-J1').click();
  await page.getByTestId('confirm-release').click();
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-revision', '2');
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-confirmed', 'false');
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-confirmed', 'true');
  await expect(page.getByTestId('item-NAGPUR')).toHaveAttribute('data-confirmed', 'true');

  // The targeted Marathi answer for J1.
  await page.getByTestId('incoming-transcript').fill(marathi.releaseJ1);
  await page.getByTestId('check-readback').click();
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'agreement');
  await page.getByTestId('confirm-J1').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
  const done = await activeHandover(page);
  expect(done.utterances.at(-1)).toMatchObject({ role: 'incoming', language: 'mr-IN' });
  expect(uncaught).toEqual([]);
});

test('the guided worker view also shows the two-language note', async ({ page }) => {
  await page.getByTestId('load-cross-language-demo').click();
  await page.getByTestId('guided-view').click();
  const guide = page.getByTestId('recipient-guide');
  await expect(guide.getByTestId('language-pair-note')).toHaveText(
    'सूचना: हिंदी · उत्तर: मराठी · दोन्ही एकाच योजनेशी पडताळले',
  );
});

test('the language note appears only when the languages differ', async ({ page }) => {
  // The landing example and a fresh same-language example: no note.
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'contradiction');
  await expect(page.getByTestId('language-pair-note')).toHaveCount(0);
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'contradiction');
  await expect(page.getByTestId('language-pair-note')).toHaveCount(0);

  // The two-language example shows it.
  await page.getByTestId('load-cross-language-demo').click();
  await expect(page.getByTestId('language-pair-note')).toHaveCount(1);

  // The incoming worker switches to Hindi and reads back the Hindi instruction in Hindi:
  // the languages now match, so the note goes away.
  await page.locator('.language-control > button').click();
  await page.getByRole('option', { name: 'हिन्दी' }).click();
  await page.getByTestId('incoming-transcript').fill(hindi.corrected);
  await page.getByTestId('check-readback').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-status', 'agreement');
  }
  await expect(page.getByTestId('language-pair-note')).toHaveCount(0);
});
