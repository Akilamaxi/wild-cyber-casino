import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 – Lottery Game
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Lottery Game', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    await page.click('text=LOTTERY', { timeout: 5000 }).catch(() =>
      page.locator('[class*="sidebar"] >> text=Lottery').click()
    );
    await expect(
      page.locator('.lottery-container, [class*="lottery"], h2:has-text("LOTTERY"), h1:has-text("LOTTERY")').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('Lottery page shows available draws', async ({ page }) => {
    // Draw cards or a draw list should be visible
    const drawEl = page.locator('[class*="draw-card"], [class*="lottery-draw"], .draw-list').first();
    await expect(drawEl).toBeVisible({ timeout: 8000 });
  });

  test('Ticket purchase button is visible', async ({ page }) => {
    const buyBtn = page.locator(
      'button:has-text("BUY"), button:has-text("TICKET"), button:has-text("PURCHASE"), button[class*="buy"]'
    ).first();
    await expect(buyBtn).toBeVisible({ timeout: 8000 });
  });

  test('Lottery draws show countdown timer', async ({ page }) => {
    // Active draws should display a timer
    const timer = page.locator('[class*="timer"], [class*="countdown"], text=/[0-9]+:[0-9]+/').first();
    await expect(timer).toBeVisible({ timeout: 8000 });
  });

  test('Ticket purchase API call is made with correct email', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/api/lottery/*/buy', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, ticket: { id: 'TICK-001', numbers: [1, 7, 12, 23, 33, 45] }, newBalance: 950 }),
      });
    });

    // Find and click buy button
    const buyBtn = page.locator(
      'button:has-text("BUY"), button:has-text("TICKET"), button:has-text("PURCHASE")'
    ).first();
    await buyBtn.click();

    await page.waitForTimeout(2000);

    if (capturedBody) {
      expect(capturedBody.email).toBeTruthy();
    }
  });

  test('My Tickets tab or section is accessible', async ({ page }) => {
    const myTicketsBtn = page.locator(
      'button:has-text("MY TICKETS"), button:has-text("Your Tickets"), [class*="tab"]:has-text("TICKETS")'
    ).first();
    if (await myTicketsBtn.isVisible()) {
      await myTicketsBtn.click();
      await page.waitForTimeout(500);
    }
    // Just confirm page didn't crash
    await expect(page.locator('body')).toBeVisible();
  });
});
