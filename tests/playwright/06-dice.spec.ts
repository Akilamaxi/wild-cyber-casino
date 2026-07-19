import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 – Cyber Dice Game
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Cyber Dice Game', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    await page.click('text=DICE', { timeout: 5000 }).catch(() =>
      page.locator('[class*="sidebar"] >> text=Dice').click()
    );
    await expect(
      page.locator('.dice-game-container, [class*="dice"], h2:has-text("DICE")').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('Dice game renders roll slider or target selector', async ({ page }) => {
    // Dice game has a slider for target number
    const slider = page.locator('input[type="range"], .dice-slider, [class*="slider"]').first();
    await expect(slider).toBeVisible({ timeout: 6000 });
  });

  test('Roll dice button exists', async ({ page }) => {
    const rollBtn = page.locator(
      'button:has-text("ROLL"), button:has-text("DICE"), button[class*="roll"], button[class*="dice-btn"]'
    ).first();
    await expect(rollBtn).toBeVisible({ timeout: 5000 });
  });

  test('Dice roll sends valid API request', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/api/dice/roll', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          roll: 45,
          target: 50,
          direction: 'UNDER',
          won: true,
          payout: 19.4,
          newBalance: 1019.4,
        }),
      });
    });

    const rollBtn = page.locator(
      'button:has-text("ROLL"), button[class*="roll"]'
    ).first();
    await rollBtn.click();

    await page.waitForTimeout(1000);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.email).toBeTruthy();
    // Bet should be a valid number, not NaN
    const betVal = Number(capturedBody.bet ?? capturedBody.betAmount);
    expect(Number.isNaN(betVal)).toBe(false);
    expect(betVal).toBeGreaterThan(0);
  });

  test('Dice result is displayed after roll', async ({ page }) => {
    await page.route('**/api/dice/roll', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          roll: 72,
          target: 50,
          direction: 'OVER',
          won: false,
          payout: 0,
          newBalance: 990,
        }),
      })
    );

    const rollBtn = page.locator('button:has-text("ROLL"), button[class*="roll"]').first();
    await rollBtn.click();

    // Some result element should appear
    const resultEl = page.locator('[class*="result"], text=/WIN|LOSE|BUST|NO WIN/i').first();
    await expect(resultEl).toBeVisible({ timeout: 6000 });
  });

  test('Dice bet input accepts numeric values', async ({ page }) => {
    const betInput = page.locator('input[type="number"]').first();
    await betInput.fill('20');
    await expect(betInput).toHaveValue('20');
  });
});
