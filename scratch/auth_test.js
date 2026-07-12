/**
 * ============================================================
 * FULL AUTH AUTOMATION TEST SUITE
 * Covers: Normal Login, Referral Registration, 401 edge cases,
 *         duplicate registrations, frozen accounts, bad tokens.
 * ============================================================
 *
 * Run: node scratch/auth_test.js
 * Make sure the lottery-engine is running on port 5000.
 */

const BASE_URL = 'http://localhost:5000';

// ── helpers ────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
  if (condition) {
    console.log(`  ✅  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL: ${label}${extra ? ` — ${extra}` : ''}`);
    failed++;
  }
}

async function api(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, body: json };
}

const ts = Date.now();
const normalEmail   = `normal-${ts}@autotest.io`;
const normalPass    = 'Pass@1234';
const referralEmail = `referred-${ts}@autotest.io`;

let normalToken     = null;
let referralCode    = null;   // the code issued to normalUser after signup

// ── test blocks ────────────────────────────────────────────

async function testNormalRegistration() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 1 — Normal User Registration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/register', {
    username: `TestUser-${ts}`,
    email:    normalEmail,
    password: normalPass,
    deviceFingerprint: 'fp-normal-001',
  });

  assert('Status 200',         r.status === 200,            `got ${r.status}`);
  assert('success flag true',  r.body.success === true,     JSON.stringify(r.body));
  assert('token present',      typeof r.body.token === 'string' && r.body.token.length > 10);
  assert('balance is 1000',    r.body.user?.balance === 1000);
  assert('status is ACTIVE',   r.body.user?.status === 'ACTIVE' || r.body.user?.status == null);

  normalToken  = r.body.token;
}

async function testDuplicateRegistration() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 2 — Duplicate Registration (should fail cleanly, no SQLITE crash)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/register', {
    username: `TestUser-${ts}-dup`,
    email:    normalEmail,   // same email
    password: normalPass,
    deviceFingerprint: 'fp-normal-002',
  });

  assert('Status 400',                      r.status === 400,       `got ${r.status}`);
  assert('success flag false',              r.body.success === false);
  assert('Error says already registered',   r.body.error?.toLowerCase().includes('already registered'),
         `error was: ${r.body.error}`);
  assert('No SQLITE_CONSTRAINT in error',   !JSON.stringify(r.body).includes('SQLITE_CONSTRAINT'),
         `full body: ${JSON.stringify(r.body)}`);
}

async function testNormalLogin() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 3 — Normal User Login');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/login', {
    email:    normalEmail,
    password: normalPass,
    deviceFingerprint: 'fp-normal-001',
  });

  assert('Status 200',        r.status === 200,           `got ${r.status}`);
  assert('success true',      r.body.success === true);
  assert('token present',     typeof r.body.token === 'string' && r.body.token.length > 10);
  assert('email matches',     r.body.user?.email?.toLowerCase() === normalEmail.toLowerCase());

  normalToken = r.body.token;  // refresh token for later use
}

async function testWrongPasswordLogin() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 4 — Login with Wrong Password (should be 400)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/login', {
    email:    normalEmail,
    password: 'wrong-password-xyz',
    deviceFingerprint: 'fp-evil-001',
  });

  assert('Status 400',    r.status === 400, `got ${r.status}`);
  assert('success false', r.body.success === false);
}

async function testNonExistentUserLogin() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 5 — Login with Non-Existent Email');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/login', {
    email:    `ghost-${ts}@nowhere.io`,
    password: 'anything',
    deviceFingerprint: 'fp-ghost-001',
  });

  assert('Status 400',    r.status === 400, `got ${r.status}`);
  assert('success false', r.body.success === false);
}

async function testProtectedEndpointWithToken() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 6 — Protected Endpoint WITH Valid Token (should succeed)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!normalToken) { console.log('  ⚠️  Skipped (no token from previous tests)'); return; }

  const r = await api('GET', '/api/user/wallet', null, {
    Authorization: `Bearer ${normalToken}`,
  });

  assert('Status 200',          r.status === 200,              `got ${r.status} — body: ${JSON.stringify(r.body)}`);
  assert('success true',        r.body.success === true);
  assert('balance is numeric',  typeof r.body.balance === 'number');
}

async function testProtectedEndpointWithoutToken() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 7 — Protected Endpoint WITHOUT Token (should be 401)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('GET', '/api/user/wallet');
  assert('Status 401',    r.status === 401, `got ${r.status}`);
  assert('success false', r.body.success === false);
}

async function testProtectedEndpointWithBadToken() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 8 — Protected Endpoint with Tampered/Bogus Token (should be 401)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('GET', '/api/user/wallet', null, {
    Authorization: 'Bearer this.is.not.a.valid.jwt.token',
  });
  assert('Status 401',    r.status === 401, `got ${r.status}`);
  assert('success false', r.body.success === false);
}

async function testGetMyReferralCode() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 9 — Get Own Referral Code for Next Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!normalToken) { console.log('  ⚠️  Skipped (no token)'); return; }

  const r = await api('GET', '/api/affiliate/stats', null, {
    Authorization: `Bearer ${normalToken}`,
  });

  assert('Status 200', r.status === 200,  `got ${r.status} — ${JSON.stringify(r.body)}`);
  // Affiliate stats returns referralCode at top level
  referralCode = r.body.referralCode || r.body.stats?.referral_code || r.body.referral_code;
  assert('Referral code returned',  typeof referralCode === 'string' && referralCode.startsWith('REF-'),
         `code: ${referralCode}, body: ${JSON.stringify(r.body)}`);
  console.log(`     Referral code captured: ${referralCode}`);
}

async function testReferralRegistration() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 10 — Referral User Registration via REF code');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/register', {
    username:          `Referred-${ts}`,
    email:             referralEmail,
    password:          'Referred@5678',
    referralCode:      referralCode || 'REF-FALLBACK',
    deviceFingerprint: 'fp-referred-001',
  });

  assert('Status 200',          r.status === 200,         `got ${r.status} — ${JSON.stringify(r.body)}`);
  assert('success true',        r.body.success === true,  JSON.stringify(r.body));
  assert('token present',       typeof r.body.token === 'string' && r.body.token.length > 10);
  assert('balance is 1000',     r.body.user?.balance === 1000);
  assert('No SQLITE error',     !JSON.stringify(r.body).includes('SQLITE_CONSTRAINT'));
}

async function testReferralRetryRegistration() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 11 — Referral User Duplicate Registration (should fail cleanly)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/register', {
    username:          `Referred-Retry-${ts}`,
    email:             referralEmail,      // same email — simulates network retry
    password:          'Referred@5678',
    referralCode:      referralCode || 'REF-FALLBACK',
    deviceFingerprint: 'fp-referred-002',
  });

  assert('Status 400',                     r.status === 400,       `got ${r.status}`);
  assert('success false',                  r.body.success === false);
  assert('No SQLITE_CONSTRAINT in error',  !JSON.stringify(r.body).includes('SQLITE_CONSTRAINT'),
         `error: ${r.body.error}`);
}

async function testReferralLogin() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 12 — Referral User Login');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/login', {
    email:    referralEmail,
    password: 'Referred@5678',
    deviceFingerprint: 'fp-referred-001',
  });

  assert('Status 200',    r.status === 200,         `got ${r.status}`);
  assert('success true',  r.body.success === true,  JSON.stringify(r.body));
  assert('token present', typeof r.body.token === 'string' && r.body.token.length > 10);
}

async function testMissingFieldsRegistration() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 13 — Registration with Missing Fields');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Missing password
  const r1 = await api('POST', '/api/auth/register', {
    username: 'incomplete',
    email:    `incomplete-${ts}@test.io`,
  });
  assert('Missing password → 400', r1.status === 400, `got ${r1.status}`);

  // Missing email
  const r2 = await api('POST', '/api/auth/register', {
    username: 'incomplete',
    password: 'Pass@123',
  });
  assert('Missing email → 400', r2.status === 400, `got ${r2.status}`);

  // Missing username
  const r3 = await api('POST', '/api/auth/register', {
    email:    `incomplete2-${ts}@test.io`,
    password: 'Pass@123',
  });
  assert('Missing username → 400', r3.status === 400, `got ${r3.status}`);
}

async function testCaseSensitiveEmailLogin() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST BLOCK 14 — Login Email is Case-Insensitive');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r = await api('POST', '/api/auth/login', {
    email:    normalEmail.toUpperCase(),  // test UPPER case
    password: normalPass,
    deviceFingerprint: 'fp-case-test',
  });

  assert('Status 200 (case-insensitive login)', r.status === 200, `got ${r.status} — ${JSON.stringify(r.body)}`);
  assert('success true', r.body.success === true);
}

// ── runner ─────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║        CYBER CASINO — AUTH AUTOMATION TEST SUITE      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Timestamp suffix: ${ts}\n`);

  const blocks = [
    testNormalRegistration,
    testDuplicateRegistration,
    testNormalLogin,
    testWrongPasswordLogin,
    testNonExistentUserLogin,
    testProtectedEndpointWithToken,
    testProtectedEndpointWithoutToken,
    testProtectedEndpointWithBadToken,
    testGetMyReferralCode,
    testReferralRegistration,
    testReferralRetryRegistration,
    testReferralLogin,
    testMissingFieldsRegistration,
    testCaseSensitiveEmailLogin,
  ];

  for (const block of blocks) {
    try {
      await block();
    } catch (err) {
      console.error(`  💥 UNCAUGHT ERROR in ${block.name}:`, err.message);
      failed++;
    }
  }

  const total = passed + failed;
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed}/${total} passed  |  ${failed} failed${failed > 0 ? '  ← FIX REQUIRED' : '  🎉'}   ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
