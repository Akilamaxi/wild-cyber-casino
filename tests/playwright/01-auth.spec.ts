import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaUI, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 – Authentication Flows
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Authentication', () => {
  test('Landing page loads and shows LOGIN + JOIN buttons', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('button.header-login-btn')).toBeVisible();
    await expect(page.locator('button.header-join-btn')).toBeVisible();
    await expect(page.locator('.header-logo')).toBeVisible();
  });

  test('Auth modal opens on LOGIN click', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button.header-login-btn');
    await expect(page.locator('.auth-modal-content')).toBeVisible();
    await expect(page.locator('button.auth-tab-btn', { hasText: 'SIGN IN' })).toBeVisible();
    await expect(page.locator('button.auth-tab-btn', { hasText: 'REGISTER' })).toBeVisible();
  });

  test('Auth modal opens on JOIN click and defaults to register tab', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button.header-join-btn');
    await expect(page.locator('.auth-modal-content')).toBeVisible();
    // Register tab should be visible (modal may default to register)
    await expect(page.locator('#username')).toBeVisible();
  });

  test('Auth modal closes on backdrop click', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button.header-login-btn');
    await page.waitForSelector('.auth-modal-content', { state: 'visible' });
    // Click backdrop (outside modal)
    await page.click('.auth-modal-backdrop', { position: { x: 10, y: 10 } });
    await expect(page.locator('.auth-modal-content')).toBeHidden();
  });

  test('Login with valid credentials succeeds', async ({ page }) => {
    await loginViaUI(page, DEMO_USER);
    // Wallet badge shows balance
    await expect(page.locator('.header-wallet-badge')).toBeVisible();
    // Username visible
    await expect(page.locator('.username-text')).toBeVisible();
  });

  test('Login with wrong password shows error message', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button.header-login-btn');
    await page.waitForSelector('.auth-modal-content', { state: 'visible' });
    await page.fill('#email', DEMO_USER.email);
    await page.fill('#password', 'wrongpassword');
    await page.click('button.auth-submit-btn');
    await expect(page.locator('.auth-error-banner')).toBeVisible({ timeout: 6000 });
  });

  test('Registration tab switch shows username field', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button.header-login-btn');
    await page.waitForSelector('.auth-modal-content', { state: 'visible' });
    await page.click('button.auth-tab-btn', { hasText: 'REGISTER' } );
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#referralCode')).toBeVisible();
  });

  test('Logout resets header to unauthenticated state', async ({ page }) => {
    await loginViaUI(page, DEMO_USER);
    // Open user dropdown
    await page.click('.header-username-badge');
    await page.click('button', { hasText: 'Logout' });
    await expect(page.locator('button.header-login-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.header-wallet-badge')).toBeHidden();
  });
});
