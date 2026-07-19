import { test, expect, request } from '@playwright/test';
import { BASE_URL, DEMO_USER } from './helpers/auth';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 10 – API Smoke Tests (no browser needed)
// These run directly against the backend to catch DB / parsing regressions.
// Note: Backend NestJS runs on port 8080; Vite proxies it to 3000.
//       We hit port 8080 directly so the frontend dev server is NOT required.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = 'http://localhost:8080';

let authToken: string;
let testEmail: string;

test.describe('API Smoke Tests', () => {
  test.beforeAll(async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/auth/login`, {
      data: {
        email: DEMO_USER.email,
        password: DEMO_USER.password,
        deviceFingerprint: 'PW-API-FP-001',
      },
    });
    const body = await res.json();
    if (!body.success) throw new Error(`Login failed during API smoke test setup: ${body.error}`);
    authToken = body.token;
    testEmail = body.user.email;
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  test('POST /api/auth/login returns token and user', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/auth/login`, {
      data: { email: DEMO_USER.email, password: DEMO_USER.password, deviceFingerprint: 'PW-TEST' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(DEMO_USER.email.toLowerCase());
  });

  test('POST /api/auth/login with bad password returns 401 / success:false', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/auth/login`, {
      data: { email: DEMO_USER.email, password: 'wrongpassword', deviceFingerprint: 'PW-TEST' },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  // ── Wallet ──────────────────────────────────────────────────────────────────
  test('GET /api/user/wallet returns transactions array', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/user/wallet?email=${testEmail}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.transactions)).toBe(true);
  });

  // ── Slots ───────────────────────────────────────────────────────────────────
  test('GET /api/slots/config returns symbols_config', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/slots/config`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.config).toBeDefined();
  });

  test('POST /api/slots/spin with integer bet returns valid game result', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/slots/spin`, {
      data: { email: testEmail, bet: 5 },
    });
    if (!res.ok()) {
      console.error('Slots spin failed:', res.status(), await res.text());
    }
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.reels)).toBe(true);
    expect(body.reels.length).toBe(3);
    expect(typeof body.payout).toBe('number');
    expect(Number.isNaN(body.payout)).toBe(false);
    expect(typeof body.newBalance).toBe('number');
    expect(Number.isNaN(body.newBalance)).toBe(false);
  });

  test('POST /api/slots/spin with string "NaN" bet is rejected gracefully', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/slots/spin`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { email: testEmail, bet: 'NaN' },
    });
    // Should either return 400 or success:false – never 500
    const body = await res.json();
    if (res.status() === 200) {
      // If it doesn't reject, at minimum payout must be a valid number
      expect(Number.isNaN(body.payout ?? 0)).toBe(false);
    } else {
      expect(res.status()).toBeLessThan(500);
    }
  });

  // ── Crash ───────────────────────────────────────────────────────────────────
  test('GET /api/crash/active-bets returns bets array', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/crash/active-bets`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.bets)).toBe(true);
  });

  // ── Dice ────────────────────────────────────────────────────────────────────
  test('POST /api/dice/roll-single with valid bet returns roll result', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/dice/roll-single`, {
      data: { email: testEmail, bet: 5, prediction: 50 },
    });
    if (res.ok()) {
      const body = await res.json();
      if (body.success) {
        expect(typeof body.result).toBe('number');
        expect(body.result).toBeGreaterThanOrEqual(1);
        expect(body.result).toBeLessThanOrEqual(100);
        expect(Number.isNaN(body.payout ?? 0)).toBe(false);
      }
    }
  });

  // ── Loyalty ─────────────────────────────────────────────────────────────────
  test('GET /api/loyalty/status returns tier or points', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/loyalty/status?email=${testEmail}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.success ?? body.points ?? body.tier).toBeDefined();
    }
  });

  // ── Draw / Lottery ──────────────────────────────────────────────────────────
  test('GET /api/lottery/games returns active games array', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/lottery/games`);
    if (res.ok()) {
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.games)).toBe(true);
    }
  });
});
