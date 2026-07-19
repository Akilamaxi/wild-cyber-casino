import { expect, test } from '@playwright/test';
import { DEMO_USER } from './helpers/auth';

const APP_URL = process.env.APP_URL || 'http://localhost:8080';

test('player login uses the production gateway origin', async ({ page }) => {
  await page.goto(APP_URL);
  await page.locator('button.header-login-btn').click();
  await page.locator('#email').fill(DEMO_USER.email);
  await page.locator('#password').fill(DEMO_USER.password);

  const loginRequest = page.waitForRequest(request => request.url().endsWith('/api/v1/auth/login'));
  await page.locator('button.auth-submit-btn').click();

  const request = await loginRequest;
  expect(new URL(request.url()).origin).toBe(new URL(APP_URL).origin);
  await expect(page.locator('.header-wallet-badge')).toBeVisible();
});

test('player registration uses the production gateway origin', async ({ page }) => {
  await page.route('**/api/v1/auth/register', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      token: 'ui-routing-test-token',
      user: { email: 'routing@example.test', username: 'RoutingTest', role: 'USER' },
    }),
  }));

  await page.goto(APP_URL);
  await page.locator('button.header-login-btn').click();
  await page.getByRole('button', { name: 'REGISTER' }).click();
  await page.locator('#username').fill('RoutingTest');
  await page.locator('#email').fill('routing@example.test');
  await page.locator('#password').fill('test-password-123');

  const registerRequest = page.waitForRequest(request => request.url().endsWith('/api/v1/auth/register'));
  await page.locator('button.auth-submit-btn').click();

  const request = await registerRequest;
  expect(new URL(request.url()).origin).toBe(new URL(APP_URL).origin);
});

test('spin wheel uses the hardened cookie session without a browser-readable bearer token', async ({ page }) => {
  await page.goto(APP_URL);
  await page.locator('button.header-login-btn').click();
  await page.locator('#email').fill(DEMO_USER.email);
  await page.locator('#password').fill(DEMO_USER.password);
  await page.locator('button.auth-submit-btn').click();
  await expect(page.locator('.header-wallet-badge')).toBeVisible();

  await page.getByText('Spin Wheel', { exact: true }).click();
  const spinRequest = page.waitForRequest(request => request.url().endsWith('/api/v1/spin'));
  await page.route('**/api/v1/spin', route => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, error: 'Test request intercepted.' }),
  }));
  await page.getByRole('button', { name: 'SPIN NOW' }).click();

  const request = await spinRequest;
  expect(request.headers().authorization).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('casino_token'))).toBeNull();
});
