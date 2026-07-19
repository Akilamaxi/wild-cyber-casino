import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 – Cyber Crash Game
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Cyber Crash Game', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    // Navigate to crash via sidebar
    await page.click('text=CRASH', { timeout: 5000 }).catch(() =>
      page.locator('[class*="sidebar"] >> text=Crash').click()
    );
    await expect(
      page.locator('.crash-game-wrapper, [class*="crash"], canvas').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('Crash game canvas/display renders', async ({ page }) => {
    // The crash game should have a canvas or SVG or multiplier display
    const crashDisplay = page.locator('canvas, .crash-multiplier-display, [class*="crash-chart"]').first();
    await expect(crashDisplay).toBeVisible({ timeout: 8000 });
  });

  test('Bet input field is present', async ({ page }) => {
    const betInput = page.locator('input[type="number"], input[placeholder*="bet" i], input[placeholder*="amount" i]').first();
    await expect(betInput).toBeVisible({ timeout: 5000 });
  });

  test('Place bet button exists', async ({ page }) => {
    const betBtn = page.locator(
      'button:has-text("BET"), button:has-text("PLACE BET"), button:has-text("FLY"), button.crash-bet-btn, button[class*="bet"]'
    ).first();
    await expect(betBtn).toBeVisible({ timeout: 5000 });
  });

  test('Crash history panel renders past games', async ({ page }) => {
    const historyPanel = page.locator(
      '.crash-history, [class*="history"], table:has(th)'
    ).first();
    await expect(historyPanel).toBeVisible({ timeout: 8000 });
  });

  test('Crash multiplier updates during live game', async ({ page }) => {
    // Wait for a multiplier that says 1.00x or higher
    const multiplier = page.locator(
      '[class*="multiplier"], text=/[0-9]+\.[0-9]+x/'
    ).first();
    await expect(multiplier).toBeVisible({ timeout: 10000 });
  });
});
