import { expect, Page, APIRequestContext } from '@playwright/test';
import { ADMIN_USER, DEMO_USER, TestUser } from './auth';

export const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'http://localhost:8080/admin/';
export const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

export interface AuthSession {
  token: string;
  user: {
    email: string;
    username: string;
    role: string;
  };
}

export async function authenticate(
  request: APIRequestContext,
  user: TestUser = ADMIN_USER,
): Promise<AuthSession> {
  const response = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
    data: {
      email: user.email,
      password: user.password,
      deviceFingerprint: 'PW-ADMIN-E2E',
    },
  });
  const body = await response.json();
  if (!response.ok() || !body.success) {
    throw new Error(`Admin test login failed: ${body.error || response.statusText()}`);
  }
  return { token: body.token, user: body.user };
}

/**
 * The admin SPA currently sends localhost development API traffic to port 5000.
 * Tests rewrite it to BACKEND_URL so they exercise the secured lottery gateway.
 */
export async function routeAdminApi(page: Page) {
  await page.route('http://localhost:5000/**', async route => {
    const original = new URL(route.request().url());
    await route.continue({ url: `${BACKEND_URL}${original.pathname}${original.search}` });
  });
}

export async function openAuthenticatedAdmin(page: Page, session: AuthSession) {
  await routeAdminApi(page);
  await page.context().addCookies([
    { name: 'casino_access', value: session.token, url: BACKEND_URL, httpOnly: true, sameSite: 'Strict' },
    { name: 'casino_csrf', value: 'playwright-admin-csrf', url: BACKEND_URL, httpOnly: false, sameSite: 'Strict' },
  ]);
  await page.addInitScript(({ user }) => {
    localStorage.setItem('cyber_admin_user', JSON.stringify(user));
  }, session);
  await page.goto(ADMIN_BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.admin-dashboard-container')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CYBER CASINO CONTROL CENTER' })).toBeVisible();
}

export async function getAdminSession(request: APIRequestContext) {
  return authenticate(request, ADMIN_USER);
}

export async function getPlayerSession(request: APIRequestContext) {
  return authenticate(request, DEMO_USER);
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
