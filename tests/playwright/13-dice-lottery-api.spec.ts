import { expect, test } from '@playwright/test';

const API = process.env.BACKEND_URL || 'http://localhost:8080';

test('dice tournament and lottery checkout complete end to end', async ({ request }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `game-flow-${suffix}@example.test`;
  const registration = await request.post(`${API}/api/v1/auth/register`, {
    data: {
      email,
      username: `Flow${suffix}`.slice(0, 40),
      password: 'SafeTestPassword!123',
      deviceFingerprint: `PW-GAME-${suffix}`,
      // referralCode is intentionally omitted.
    },
  });
  expect(registration.ok(), await registration.text()).toBe(true);
  const session = await registration.json();
  const headers = { Authorization: `Bearer ${session.token}` };

  const tournamentResponse = await request.get(`${API}/api/v1/dice/tournaments`, { headers });
  expect(tournamentResponse.ok()).toBe(true);
  const tournaments = (await tournamentResponse.json()).tournaments;
  expect(tournaments.length).toBeGreaterThan(0);
  expect(new Date(tournaments[0].endsAt ?? tournaments[0].ends_at).getTime()).toBeGreaterThan(Date.now());

  const tournamentId = tournaments[0].id;
  const joined = await request.post(`${API}/api/v1/dice/tournament/join`, {
    headers, data: { tournamentId },
  });
  expect(joined.ok(), await joined.text()).toBe(true);
  expect((await joined.json()).newBalance).toBeLessThan(session.user.balance);

  const rolled = await request.post(`${API}/api/v1/dice/tournament/roll`, {
    headers, data: { tournamentId },
  });
  expect(rolled.ok(), await rolled.text()).toBe(true);
  const roll = await rolled.json();
  expect(roll.sum).toBeGreaterThanOrEqual(2);
  expect(roll.sum).toBeLessThanOrEqual(12);
  expect(roll.rollsLeft).toBe(9);

  const lotteryName = 'The Grand Ganache';
  const statusResponse = await request.get(
    `${API}/api/v1/lottery/status?lotteryName=${encodeURIComponent(lotteryName)}&email=${encodeURIComponent(email)}`,
    { headers },
  );
  expect(statusResponse.ok(), await statusResponse.text()).toBe(true);

  const poolResponse = await request.get(
    `${API}/api/v1/lottery/pool-tickets?lotteryName=${encodeURIComponent(lotteryName)}`,
    { headers },
  );
  expect(poolResponse.ok(), await poolResponse.text()).toBe(true);
  const pool = (await poolResponse.json()).tickets;
  expect(pool.length).toBeGreaterThan(0);
  expect(pool[0].chosenNumbers).toHaveLength(6);
  expect(pool[0].drawId).toBeTruthy();

  const ticketIds = [pool[0].id];
  const reserved = await request.post(`${API}/api/v1/lottery/reserve`, {
    headers, data: { email, ticketIds },
  });
  expect(reserved.ok(), await reserved.text()).toBe(true);

  const checkout = await request.post(`${API}/api/v1/lottery/checkout`, {
    headers, data: { email, ticketIds },
  });
  expect(checkout.ok(), await checkout.text()).toBe(true);
  const purchase = await checkout.json();
  expect(purchase.totalBetAmount).toBeGreaterThan(0);
  expect(purchase.newBalance).toBeLessThan(session.user.balance);
});
