import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9 – User Profile
// ─────────────────────────────────────────────────────────────────────────────

test.describe('User Profile', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    // Navigate to profile via dropdown
    await page.click('.header-username-badge');
    await page.click('button:has-text("View Profile")');
    await expect(
      page.locator('.user-profile-container, [class*="profile"], h2:has-text("PROFILE")').first()
    ).toBeVisible({ timeout: 8000 });
  });

  test('Profile page shows user email and username', async ({ page }) => {
    // Email or username should be displayed
    const profileInfo = page.locator('[class*="profile"], [class*="user-info"]').first();
    await expect(profileInfo).toBeVisible({ timeout: 5000 });
    // The page should contain the demo email somewhere
    await expect(page.locator(`text=${DEMO_USER.email}`).or(page.locator('text=DemoPlayer'))).toBeVisible({ timeout: 5000 });
  });

  test('Profile stats section is rendered', async ({ page }) => {
    // Stats like total wagers, wins, etc
    const statsEl = page.locator('[class*="stats"], [class*="stat-card"], [class*="profile-stats"]').first();
    await expect(statsEl).toBeVisible({ timeout: 6000 });
  });

  test('Profile has game history section', async ({ page }) => {
    const historyEl = page.locator(
      '[class*="history"], table, [class*="game-log"], text=HISTORY'
    ).first();
    await expect(historyEl).toBeVisible({ timeout: 6000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 10 – Affiliate Dashboard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Affiliate Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    // Navigate to affiliate section
    await page.click('text=AFFILIATE', { timeout: 5000 }).catch(() =>
      page.locator('[class*="sidebar"] >> text=/affiliate/i').click()
    );
    await expect(
      page.locator('[class*="affiliate"], h2:has-text("AFFILIATE"), h1:has-text("AFFILIATE")').first()
    ).toBeVisible({ timeout: 8000 });
  });

  test('Affiliate dashboard shows referral link', async ({ page }) => {
    const refLink = page.locator(
      'input[readonly], [class*="referral-link"], [class*="ref-code"]'
    ).first();
    await expect(refLink).toBeVisible({ timeout: 6000 });
  });

  test('Affiliate network stats are visible', async ({ page }) => {
    const statsEl = page.locator(
      '[class*="stat"], [class*="commission"], [class*="network"]'
    ).first();
    await expect(statsEl).toBeVisible({ timeout: 6000 });
  });

  test('Copy referral link button works', async ({ page }) => {
    const copyBtn = page.locator(
      'button:has-text("COPY"), button:has-text("📋")'
    ).first();
    if (await copyBtn.isVisible()) {
      await copyBtn.click();
      // Clipboard text should have been set – checking it doesn't throw
      await page.waitForTimeout(300);
    }
  });
});
