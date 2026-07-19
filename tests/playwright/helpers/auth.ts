import { Page, expect } from '@playwright/test';

export const BASE_URL = 'http://localhost:3000';

export interface TestUser {
  email: string;
  password: string;
  username?: string;
}

/** Demo user seeded in the DB. Adjust if your seed data differs. */
export const DEMO_USER: TestUser = {
  email: 'demo@casino.com',
  password: 'password123',
  username: 'DemoPlayer',
};

/** Admin user */
export const ADMIN_USER: TestUser = {
  email: 'admin@casino.com',
  password: 'admin123',
  username: 'Admin',
};

/**
 * Login via the UI modal.
 * Resolves once the modal closes and the wallet badge is visible.
 */
export async function loginViaUI(page: Page, user: TestUser = DEMO_USER) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Open login modal
  const loginBtn = page.locator('button.header-login-btn');
  await loginBtn.click();

  await page.waitForSelector('.auth-modal-content', { state: 'visible' });

  // Ensure we are on the Sign-In tab
  const signInTab = page.locator('button.auth-tab-btn', { hasText: 'SIGN IN' });
  await signInTab.click();

  await page.fill('#email', user.email);
  await page.fill('#password', user.password);

  await page.click('button.auth-submit-btn');

  // Wait for modal to close
  await page.waitForSelector('.auth-modal-content', { state: 'hidden', timeout: 8000 });

  // Confirm user is logged in (wallet badge visible)
  await expect(page.locator('.header-wallet-badge')).toBeVisible({ timeout: 6000 });
}

/**
 * Login via direct API call and inject token into localStorage,
 * then reload – faster than UI login, great for state setup.
 */
export async function loginViaAPI(page: Page, user: TestUser = DEMO_USER) {
  const res = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      email: user.email,
      password: user.password,
      deviceFingerprint: 'PW-TEST-FP-001',
    },
  });

  const body = await res.json();
  if (!body.success) throw new Error(`API login failed: ${body.error}`);

  // Set token + user in localStorage before navigation
  await page.goto(BASE_URL);
  await page.evaluate(({ token, userData }) => {
    localStorage.setItem('casino_token', token);
    localStorage.setItem('casino_user', JSON.stringify(userData));
  }, { token: body.token, userData: body.user });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.header-wallet-badge')).toBeVisible({ timeout: 8000 });

  return body.user;
}
