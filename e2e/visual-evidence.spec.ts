import { expect, test, type Page } from '@playwright/test';

function watchConsole(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`Uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      failures.push(`${message.type()}: ${message.text()}`);
  });
  return failures;
}

async function expectHealthyInitialPage(page: Page) {
  await expect(page).toHaveTitle(/BolRelay/);
  await expect(
    page.getByRole('heading', { name: 'Afternoon dispatch', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('incoming-transcript')).toBeVisible();
  await expect(page.getByTestId('item-NAGPUR')).toBeVisible();
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-status', 'contradiction');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test('desktop design evidence: initial discrepancy and selective release', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  const failures = watchConsole(page);
  await page.goto('/');
  await expectHealthyInitialPage(page);
  await page.screenshot({
    path: testInfo.outputPath('desktop-initial-1536x1024.png'),
    fullPage: false,
    animations: 'disabled',
  });

  await page
    .getByTestId('incoming-transcript')
    .fill(
      'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.',
    );
  await page.getByTestId('check-readback').click();
  await expect(page.getByTestId('confirm-handover')).toBeEnabled();
  await page.getByTestId('confirm-handover').click();
  for (const id of ['NAGPUR', 'J1', 'J2']) {
    await expect(page.getByTestId(`item-${id}`)).toHaveAttribute('data-confirmed', 'true');
  }
  await page.getByTestId('release-J1').click();
  await page.getByTestId('confirm-release').click();
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-revision', '2');
  await expect(page.getByTestId('item-J1')).toHaveAttribute('data-confirmed', 'false');
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-action', 'hold');
  await expect(page.getByTestId('item-J2')).toHaveAttribute('data-confirmed', 'true');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('desktop-after-j1-release-1536x1024.png'),
    fullPage: false,
    animations: 'disabled',
  });
  expect(failures).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`narrow viewport design evidence: ${viewport.width} by ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const failures = watchConsole(page);
    await page.goto('/');
    await expectHealthyInitialPage(page);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-initial-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);

    await page
      .getByTestId('incoming-transcript')
      .fill(
        'I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.',
      );
    await page.getByTestId('check-readback').click();
    await page.getByTestId('confirm-handover').click();
    await expect(page.getByTestId('item-J1')).toHaveAttribute('data-confirmed', 'true');
    await page.screenshot({
      path: testInfo.outputPath(`mobile-confirmed-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(failures).toEqual([]);
  });
}
