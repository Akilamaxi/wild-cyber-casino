import { test, expect } from '@playwright/test';
import { ADMIN_USER } from './helpers/auth';
import {
  ADMIN_BASE_URL,
  BACKEND_URL,
  bearer,
  getAdminSession,
  getPlayerSession,
  openAuthenticatedAdmin,
  routeAdminApi,
} from './helpers/admin';

test.describe('Admin authorization', () => {
  test('rejects an unauthenticated admin request', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/admin/games`);
    expect(response.status()).toBe(401);
  });

  test('rejects a normal player from admin endpoints', async ({ request }) => {
    const player = await getPlayerSession(request);
    const response = await request.get(`${BACKEND_URL}/api/v1/admin/games`, {
      headers: bearer(player.token),
    });
    expect(response.status()).toBe(403);
  });

  test('allows an administrator to read protected operational resources', async ({ request }) => {
    const admin = await getAdminSession(request);
    const resources = [
      '/api/v1/admin/games',
      '/api/v1/admin/spinwheel-prizes',
      '/api/v1/admin/slots/config',
      '/api/v1/admin/dice/config',
      '/api/v1/admin/crash/config',
      '/api/v1/admin/plinko/config',
      '/api/v1/admin/affiliate/config',
      '/api/v1/admin/security/alerts',
      '/api/v1/admin/audit-logs',
    ];

    for (const path of resources) {
      const response = await request.get(`${BACKEND_URL}${path}`, {
        headers: bearer(admin.token),
      });
      expect(response.ok(), `${path} returned ${response.status()}`).toBe(true);
    }
  });
});

test.describe('Admin portal', () => {
  test('clears an expired administrator session and returns to login', async ({ page }) => {
    await routeAdminApi(page);
    await page.addInitScript(() => {
      sessionStorage.setItem('cyber_admin_token', 'expired-token');
      localStorage.setItem('cyber_admin_user', JSON.stringify({
        email: 'admin@casino.com', username: 'Admin', role: 'ADMIN',
      }));
    });
    await page.goto(ADMIN_BASE_URL);

    await expect(page.locator('form.login-form')).toBeVisible();
    await expect(page.locator('.login-error-alert')).toContainText('session expired');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('cyber_admin_token'))).toBeNull();
  });

  test('logs in through the UI and disconnects cleanly', async ({ page }) => {
    await routeAdminApi(page);
    await page.goto(ADMIN_BASE_URL);

    const loginForm = page.locator('form.login-form');
    await loginForm.locator('input[type="email"]').fill(ADMIN_USER.email);
    await loginForm.locator('input[type="password"]').fill(ADMIN_USER.password);
    await loginForm.getByRole('button', { name: 'AUTHORIZE ACCESS' }).click();

    await expect(page.locator('.admin-dashboard-container')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Admin Session:/)).toBeVisible();
    await expect.poll(() => page.context().cookies().then(cookies => cookies.some(cookie => cookie.name === 'casino_access' && cookie.httpOnly))).toBe(true);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('cyber_admin_token'))).toBeNull();

    await page.getByRole('button', { name: 'DISCONNECT' }).click();
    await expect(page.locator('form.login-form')).toBeVisible();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('cyber_admin_token'))).toBeNull();
  });

  test('shows an error for invalid administrator credentials', async ({ page }) => {
    await routeAdminApi(page);
    await page.goto(ADMIN_BASE_URL);

    const loginForm = page.locator('form.login-form');
    await loginForm.locator('input[type="email"]').fill(ADMIN_USER.email);
    await loginForm.locator('input[type="password"]').fill('incorrect-password');
    await loginForm.getByRole('button', { name: 'AUTHORIZE ACCESS' }).click();

    await expect(page.locator('.login-error-alert')).toBeVisible();
  });

  test('loads and navigates every admin workspace', async ({ page, request }) => {
    await openAuthenticatedAdmin(page, await getAdminSession(request));

    const sections = [
      { menu: /Lottery Configurations/, heading: 'ACTIVE GAME CONFIGURATIONS' },
      { menu: /Spin Wheel Customizer/, heading: /SPIN WHEEL/i },
      { menu: /Slots Control Desk/, heading: /SLOTS/i },
      { menu: /Dice Arena Controller/, heading: /DICE/i },
      { menu: /Crash Engine Control/, heading: /CRASH/i },
      { menu: /Plinko RTP Control/, heading: /PLINKO/i },
      { menu: /Affiliate & Referrals/, heading: /AFFILIATE/i },
      { menu: /Security & Risk Control/, heading: /SECURITY|RISK/i },
    ];

    for (const section of sections) {
      const menu = page.getByRole('button', { name: section.menu });
      await menu.click();
      await expect(menu).toHaveClass(/active/);
      await expect(page.getByRole('heading', { name: section.heading }).first()).toBeVisible();
    }
  });

  test('provides compact paginated operations tables and player-app switching', async ({ page, request }) => {
    await openAuthenticatedAdmin(page, await getAdminSession(request));
    await expect(page.getByRole('link', { name: 'Switch to the player application' })).toHaveAttribute('href', '/');

    await page.getByRole('button', { name: /Plinko RTP Control/ }).click();
    await expect(page.getByRole('table', { name: /Plinko outcomes/i })).toBeVisible();
    await expect(page.getByLabel('Plinko outcomes pagination')).toBeVisible();

    await page.getByRole('button', { name: /Affiliate & Referrals/ }).click();
    await expect(page.getByLabel('Shadow commission logs pagination')).toBeVisible();

    await page.getByRole('button', { name: /Security & Risk Control/ }).click();
    await expect(page.getByLabel('Security alerts pagination')).toBeVisible();
    await expect(page.getByLabel('Security rules pagination')).toBeVisible();
  });

  test('enters and cancels lottery edit mode without changing data', async ({ page, request }) => {
    const admin = await getAdminSession(request);
    const headers = { ...bearer(admin.token), 'Content-Type': 'application/json' };
    const fixtureId = `PW-ADMIN-${Date.now()}`;
    const createResponse = await request.post(`${BACKEND_URL}/api/v1/admin/games`, {
      headers,
      data: {
        id: fixtureId,
        name: 'Playwright Admin Fixture',
        draw_interval_ms: 60_000,
        ticket_price: 10,
        max_tickets_per_user: 100,
        house_edge_percentage: 0.3,
        status: 'ACTIVE',
      },
    });
    expect(createResponse.ok()).toBe(true);

    try {
      await openAuthenticatedAdmin(page, admin);
      const fixtureRow = page.locator('table.admin-table tbody tr', { hasText: fixtureId });
      await expect(fixtureRow).toBeVisible();

      await fixtureRow.getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('button', { name: 'SAVE CHANGES' })).toBeVisible();
      await expect(page.locator('form.admin-form input[type="text"]').first()).toHaveValue(fixtureId);

      await page.getByRole('button', { name: 'CANCEL' }).click();
      await expect(page.getByRole('button', { name: 'DEPLOY LOTTO' })).toBeVisible();
    } finally {
      const deleteResponse = await request.delete(`${BACKEND_URL}/api/v1/admin/games/${fixtureId}`, { headers });
      expect(deleteResponse.ok()).toBe(true);
    }
  });
});

test.describe('Admin configuration API', () => {
  test('round-trips the existing crash configuration without changing values', async ({ request }) => {
    const admin = await getAdminSession(request);
    const headers = { ...bearer(admin.token), 'Content-Type': 'application/json' };

    const beforeResponse = await request.get(`${BACKEND_URL}/api/v1/admin/crash/config`, { headers });
    expect(beforeResponse.ok()).toBe(true);
    const before = await beforeResponse.json();
    expect(before.config).toBeDefined();

    const updateResponse = await request.put(`${BACKEND_URL}/api/v1/admin/crash/config`, {
      headers,
      data: before.config,
    });
    expect(updateResponse.ok()).toBe(true);

    const afterResponse = await request.get(`${BACKEND_URL}/api/v1/admin/crash/config`, { headers });
    const after = await afterResponse.json();
    expect(after.config).toMatchObject(before.config);
  });
});
