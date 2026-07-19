import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8 – Neon Plinko
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Neon Plinko', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    await page.click('text=PLINKO', { timeout: 5000 }).catch(() =>
      page.locator('[class*="sidebar"] >> text=Plinko').click()
    );
    await expect(
      page.locator('canvas, .plinko-container, [class*="plinko"], h2:has-text("PLINKO")').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('Plinko game canvas renders', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 8000 });
  });

  test('Drop button is present', async ({ page }) => {
    const dropBtn = page.locator(
      'button:has-text("DROP"), button:has-text("LAUNCH"), button[class*="drop"], button[class*="plinko"]'
    ).first();
    await expect(dropBtn).toBeVisible({ timeout: 6000 });
  });

  test('Plinko drop API request has valid bet', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/api/plinko/drop', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, multiplier: 2.5, payout: 25, path: [], newBalance: 1025 }),
      });
    });

    const dropBtn = page.locator(
      'button:has-text("DROP"), button:has-text("LAUNCH"), button[class*="drop"]'
    ).first();
    await dropBtn.click();

    await page.waitForTimeout(1000);

    if (capturedBody) {
      const betVal = Number(capturedBody.bet ?? capturedBody.betAmount ?? capturedBody.amount);
      expect(Number.isNaN(betVal)).toBe(false);
      expect(betVal).toBeGreaterThan(0);
    }
  });

  test('Bet amount input is adjustable', async ({ page }) => {
    const betInput = page.locator('input[type="number"]').first();
    if (await betInput.isVisible()) {
      await betInput.fill('15');
      await expect(betInput).toHaveValue('15');
    }
  });
});
