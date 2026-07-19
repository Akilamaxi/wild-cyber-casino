import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 – Navigation & Sidebar
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Navigation & Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
  });

  test('Sidebar is visible after login', async ({ page }) => {
    await expect(page.locator('.sidebar, [class*="sidebar"]')).toBeVisible();
  });

  test('Wallet nav item navigates to wallet panel', async ({ page }) => {
    // Clicking the wallet badge in header
    await page.click('.header-wallet-badge');
    await expect(page.locator('.wallet-panel-container, h2:has-text("CYBER WALLET")')).toBeVisible({ timeout: 5000 });
  });

  test('Username dropdown has Profile and Wallet options', async ({ page }) => {
    await page.click('.header-username-badge');
    await expect(page.locator('button', { hasText: 'View Profile' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Wallet Panel' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Logout' })).toBeVisible();
  });

  test('Header logo click returns to landing page', async ({ page }) => {
    // Navigate away first
    await page.click('.header-wallet-badge');
    // Click logo
    await page.click('.header-logo');
    // Landing page content should be visible
    await expect(page.locator('.landing-hero, .game-grid, [class*="landing"]')).toBeVisible({ timeout: 5000 });
  });

  test('Chat button is clickable', async ({ page }) => {
    const chatBtn = page.locator('.header-chat-badge');
    await expect(chatBtn).toBeVisible();
    await chatBtn.click();
    // Chat panel should open or toggle
    // We just verify no crash
    await page.waitForTimeout(500);
  });
});
