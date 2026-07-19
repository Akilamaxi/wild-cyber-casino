import { test, expect } from '@playwright/test';
import { BASE_URL, DEMO_USER, loginViaAPI } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 – Wallet Panel (Deposit & Withdraw)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Wallet Panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, DEMO_USER);
    // Navigate to wallet
    await page.click('.header-wallet-badge');
    await expect(page.locator('h2:has-text("CYBER WALLET")')).toBeVisible({ timeout: 5000 });
  });

  test('Wallet panel shows balance cards', async ({ page }) => {
    await expect(page.locator('.wallet-card.cash-card')).toBeVisible();
    await expect(page.locator('.wallet-card.bonus-card')).toBeVisible();
    await expect(page.locator('.wallet-card.cashback-card')).toBeVisible();
  });

  test('Deposit box is visible with input and button', async ({ page }) => {
    await expect(page.locator('.action-box.deposit-box')).toBeVisible();
    await expect(page.locator('.deposit-box input[type="number"]')).toBeVisible();
    await expect(page.locator('button.deposit-btn')).toBeVisible();
  });

  test('Withdraw box is visible with input and button', async ({ page }) => {
    await expect(page.locator('.action-box.withdraw-box')).toBeVisible();
    await expect(page.locator('.withdraw-box input[type="number"]')).toBeVisible();
    await expect(page.locator('button.withdraw-btn')).toBeVisible();
  });

  test('Deposit form opens CyberPay gateway modal', async ({ page }) => {
    await page.fill('.deposit-box input[type="number"]', '50');
    await page.click('button.deposit-btn');
    // Gateway modal should appear
    await expect(page.locator('.gateway-modal-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.gateway-modal-content')).toContainText('CYBERPAY GATEWAY');
  });

  test('Payment gateway autofill test card works', async ({ page }) => {
    await page.fill('.deposit-box input[type="number"]', '50');
    await page.click('button.deposit-btn');
    await expect(page.locator('.gateway-modal-content')).toBeVisible({ timeout: 5000 });
    await page.click('button.test-card-autofill-btn');
    await expect(page.locator('input[placeholder="John Doe"]')).toHaveValue('John Doe');
    await expect(page.locator('input[placeholder="4111 2222 3333 4444"]')).toHaveValue('4111 2222 3333 4444');
  });

  test('Payment gateway processes credit card deposit successfully', async ({ page }) => {
    // Intercept the deposit API call
    let depositCalled = false;
    await page.route('**/api/user/deposit', (route) => {
      depositCalled = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, newBalance: 1050 }),
      });
    });

    await page.fill('.deposit-box input[type="number"]', '50');
    await page.click('button.deposit-btn');
    await expect(page.locator('.gateway-modal-content')).toBeVisible({ timeout: 5000 });

    // Autofill test card
    await page.click('button.test-card-autofill-btn');
    await page.fill('input[placeholder="123"]', '123');

    await page.click('.gateway-submit-btn');

    // Should go through processing state
    await expect(page.locator('h4:has-text("PROCESSING FUNDS")')).toBeVisible({ timeout: 4000 });
    // Then success state
    await expect(page.locator('h4:has-text("PAYMENT COMPLETED")')).toBeVisible({ timeout: 10000 });
    expect(depositCalled).toBe(true);
  });

  test('Withdraw with zero amount shows validation error', async ({ page }) => {
    await page.fill('.withdraw-box input[type="number"]', '0');
    await page.click('button.withdraw-btn');
    await expect(page.locator('.wallet-feedback-banner.error-banner')).toBeVisible({ timeout: 5000 });
  });

  test('Withdraw with insufficient balance shows error', async ({ page }) => {
    await page.fill('.withdraw-box input[type="number"]', '9999999');
    await page.click('button.withdraw-btn');
    await expect(page.locator('.wallet-feedback-banner.error-banner')).toBeVisible({ timeout: 5000 });
  });

  test('Transaction history table is rendered', async ({ page }) => {
    await expect(page.locator('.history-table')).toBeVisible();
    await expect(page.locator('.history-table thead')).toBeVisible();
  });

  test('Gateway modal closes with X button', async ({ page }) => {
    await page.fill('.deposit-box input[type="number"]', '50');
    await page.click('button.deposit-btn');
    await expect(page.locator('.gateway-modal-content')).toBeVisible({ timeout: 5000 });
    await page.click('.gateway-close-btn');
    await expect(page.locator('.gateway-modal-content')).toBeHidden();
  });
});
