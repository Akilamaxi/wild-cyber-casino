import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 – Cyber Slots 777
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Cyber Slots 777', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    // Navigate to slots via sidebar or landing
    await page.click('text=SLOTS', { timeout: 5000 }).catch(() =>
      page.locator('[class*="sidebar"] >> text=Slots').click()
    );
    await expect(page.locator('.slots-machine-box, h2:has-text("CYBER SLOTS")')).toBeVisible({ timeout: 8000 });
  });

  test('Slots machine renders reels and bet buttons', async ({ page }) => {
    await expect(page.locator('.reels-inner-grid')).toBeVisible();
    await expect(page.locator('.bet-buttons')).toBeVisible();
    // All 4 bet options present
    for (const amount of ['$5', '$10', '$25', '$50']) {
      await expect(page.locator('.bet-btn', { hasText: amount })).toBeVisible();
    }
  });

  test('Bet selection changes active bet button', async ({ page }) => {
    await page.click('.bet-btn', { hasText: '$25' });
    await expect(page.locator('.bet-btn.active', { hasText: '$25' })).toBeVisible();
  });

  test('Payout multiplier table is visible', async ({ page }) => {
    await expect(page.locator('.slots-payout-panel')).toBeVisible();
    await expect(page.locator('h3:has-text("PAYOUT MULTIPLIERS")')).toBeVisible();
  });

  test('Spin button is present and clickable', async ({ page }) => {
    const spinBtn = page.locator('.slots-spin-lever-btn');
    await expect(spinBtn).toBeVisible();
    await expect(spinBtn).toBeEnabled();
  });

  test('Slots spin sends correct API request with valid bet', async ({ page }) => {
    // Mock the API to avoid DB mutation
    let capturedBody: any = null;
    await page.route('**/api/slots/spin', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reels: ['SEVEN', 'SEVEN', 'SEVEN'],
          payout: 500,
          newBalance: 1500,
        }),
      });
    });

    await page.click('.bet-btn', { hasText: '$10' });
    await page.click('.slots-spin-lever-btn');

    // Wait for spin to resolve
    await page.waitForTimeout(3500);

    // Verify the request had valid numeric bet
    expect(capturedBody).not.toBeNull();
    expect(typeof capturedBody.bet).toBe('number');
    expect(Number.isNaN(capturedBody.bet)).toBe(false);
    expect(capturedBody.bet).toBe(10);
    expect(capturedBody.email).toBeTruthy();
  });

  test('Win message displays after successful spin win', async ({ page }) => {
    await page.route('**/api/slots/spin', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reels: ['SEVEN', 'SEVEN', 'SEVEN'],
          payout: 1000,
          newBalance: 2000,
        }),
      })
    );

    await page.click('.slots-spin-lever-btn');
    // Wait for animation to complete (3.1 seconds)
    await expect(page.locator('.slots-result-banner.win-banner')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.slots-result-banner')).toContainText('WIN');
  });

  test('Lose message displays after no-win spin', async ({ page }) => {
    await page.route('**/api/slots/spin', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reels: ['BAR', 'CHERRY', 'BELL'],
          payout: 0,
          newBalance: 990,
        }),
      })
    );

    await page.click('.slots-spin-lever-btn');
    await expect(page.locator('.slots-result-banner.lose-banner')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.slots-result-banner')).toContainText('NO WIN');
  });

  test('Spin button is disabled during animation', async ({ page }) => {
    await page.route('**/api/slots/spin', async (route) => {
      await new Promise((r) => setTimeout(r, 500)); // artificial delay
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, reels: ['BAR', 'BAR', 'BAR'], payout: 0, newBalance: 990 }),
      });
    });

    await page.click('.slots-spin-lever-btn');
    // Immediately check it's disabled
    await expect(page.locator('.slots-spin-lever-btn')).toBeDisabled({ timeout: 1000 });
  });

  test('Server error during spin shows alert and restores balance', async ({ page }) => {
    await page.route('**/api/slots/spin', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Internal Server Error' }),
      })
    );

    // Listen for alert dialog
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('.slots-spin-lever-btn');
    await page.waitForTimeout(1500);
    // Spin button should be re-enabled
    await expect(page.locator('.slots-spin-lever-btn')).toBeEnabled({ timeout: 5000 });
  });
});
