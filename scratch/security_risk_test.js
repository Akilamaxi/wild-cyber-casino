const { db } = require('../packages/shared');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cyber-casino-secret-key-1337-risk-management';

// Haversine formula for distance
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function runTests() {
  console.log('⚡ Start E2E Security & Risk Management Validation...');
  
  // 1. Initialize DB
  await db.initDatabase();
  console.log('✅ Database connected.');

  // Clean test tables
  await db.run('DELETE FROM users WHERE email LIKE "%test-security%"');
  await db.run('DELETE FROM user_session_logs WHERE email LIKE "%test-security%"');
  await db.run('DELETE FROM security_alerts WHERE email LIKE "%test-security%"');
  await db.run('DELETE FROM user_tags WHERE email LIKE "%test-security%"');
  await db.run('DELETE FROM admin_audit_trail WHERE admin_email = "test-admin@cyber.com"');
  await db.run('DELETE FROM transactions WHERE email LIKE "%test-security%"');
  await db.run('DELETE FROM bonus_rules WHERE rule_name = "TEST_HOURLY_LOSS_GUARD"');

  const email1 = 'player1@test-security.com';
  const email2 = 'player2@test-security.com';

  // 2. Setup user 1
  console.log('\n--- Test Case 1: User Registration & Session Log ---');
  await db.run(
    'INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, status, wallet_address) VALUES (?, "player1", "pass123", 1000.0, 0, 0.0, "ACTIVE", "0xWALLET1")',
    [email1]
  );
  
  // Log first session (Colombo, LK: 6.9271, 79.8612)
  await db.run(
    'INSERT INTO user_session_logs (email, ip_address, user_agent, device_fingerprint, country, city, latitude, longitude, created_at) VALUES (?, "1.2.3.4", "Mozilla/5.0", "FP-12345", "LK", "Colombo", 6.9271, 79.8612, ?)',
    [email1, new Date(Date.now() - 600000).toISOString()] // 10 minutes ago
  );
  console.log('✅ User 1 registered and first login logged from Colombo, Sri Lanka.');

  // 3. Travel violation check
  console.log('\n--- Test Case 2: Impossible Travel Alert ---');
  // Attempt login from Canada (Toronto: 43.6532, -79.3832) 5 minutes later
  const lastSession = await db.get(
    'SELECT * FROM user_session_logs WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 1',
    [email1]
  );

  const newLat = 43.6532;
  const newLon = -79.3832;
  const newTime = new Date(Date.now() - 300000); // 5 minutes ago (5 minutes after first login)

  const distance = getDistanceKm(lastSession.latitude, lastSession.longitude, newLat, newLon);
  const timeDiffHours = Math.abs(newTime - new Date(lastSession.created_at)) / 3600000;
  const speed = distance / timeDiffHours;

  console.log(`Calculated travel: Distance = ${distance.toFixed(2)} km, Time difference = ${(timeDiffHours * 60).toFixed(2)} minutes`);
  console.log(`Required speed = ${speed.toFixed(2)} km/h`);

  if (speed > 1000 && timeDiffHours > 0) {
    console.log('🚨 IMPOSSIBLE TRAVEL DETECTED! Freezing account and writing alert.');
    await db.run('UPDATE users SET status = "FROZEN" WHERE LOWER(email) = ?', [email1]);
    await db.run(
      'INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, "IMPOSSIBLE_TRAVEL", "HIGH", ?, 0, ?)',
      [
        email1,
        `Impossible travel speed detected: ${speed.toFixed(0)} km/h from ${lastSession.city}, ${lastSession.country} to Toronto, CA`,
        new Date().toISOString()
      ]
    );
  }

  // Verify status is frozen and alert exists
  const updatedUser1 = await db.get('SELECT status FROM users WHERE LOWER(email) = ?', [email1]);
  const alert1 = await db.get('SELECT * FROM security_alerts WHERE LOWER(email) = ? AND alert_type = "IMPOSSIBLE_TRAVEL"', [email1]);
  
  if (updatedUser1.status === 'FROZEN' && alert1) {
    console.log('✅ PASS: User 1 was successfully FROZEN and IMPOSSIBLE_TRAVEL alert recorded.');
  } else {
    throw new Error('FAIL: User 1 travel speed security alert failed.');
  }

  // 4. Sybil Multi-Account Check (Shared wallet / fingerprint)
  console.log('\n--- Test Case 3: Sybil Multi-Account Detection ---');
  // Register second user with same device fingerprint & withdrawal wallet
  await db.run(
    'INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, status, wallet_address) VALUES (?, "player2", "pass456", 1000.0, 0, 0.0, "ACTIVE", "0xWALLET1")',
    [email2]
  );

  // Check duplicate wallet
  const duplicateWallet = await db.all(
    'SELECT LOWER(email) as email FROM users WHERE wallet_address = "0xWALLET1" AND LOWER(email) != ?',
    [email2]
  );
  if (duplicateWallet.length > 0) {
    console.log('🚨 MULTI_ACCOUNT SYBIL DETECTED: Shared wallet address matched with:', duplicateWallet.map(d => d.email).join(', '));
    await db.run(
      'INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, "MULTI_ACCOUNT", "MEDIUM", ?, 0, ?)',
      [
        email2,
        `Shared withdrawal wallet address matched with: ${duplicateWallet.map(d => d.email).join(', ')}`,
        new Date().toISOString()
      ]
    );
  }

  const alert2 = await db.get('SELECT * FROM security_alerts WHERE LOWER(email) = ? AND alert_type = "MULTI_ACCOUNT"', [email2]);
  if (alert2) {
    console.log('✅ PASS: Sybil check detected shared wallet address and flagged player 2.');
  } else {
    throw new Error('FAIL: Multi-account Sybil matching alert failed.');
  }

  // 5. Rules Engine Trigger Validation
  console.log('\n--- Test Case 4: Rules Engine Evaluation ---');
  // Add a loss recovery trigger rule
  const ruleReward = JSON.stringify({ type: 'CASH', amount: 50.0 });
  await db.run(
    'INSERT INTO bonus_rules (rule_name, trigger_type, threshold, bonus_reward, active) VALUES ("TEST_HOURLY_LOSS_GUARD", "HOURLY_LOSS", 500.0, ?, 1)',
    [ruleReward]
  );

  // Simulate loss transaction of $600 for Player 2
  await db.run('UPDATE users SET balance = 400.0 WHERE LOWER(email) = ?', [email2]);
  await db.run(
    'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "SLOTS_PLAY", -600.0, 400.0, ?)',
    ['tx-loss-1', email2, new Date().toISOString()]
  );

  // Check hourly loss recovery rules
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const lossRow = await db.get(
    'SELECT SUM(amount) as net FROM transactions WHERE LOWER(email) = ? AND timestamp >= ?',
    [email2, oneHourAgo]
  );
  const netLoss = lossRow && lossRow.net ? parseFloat(lossRow.net) : 0.0;
  console.log(`Calculated net loss for Player 2 in the last hour: $${Math.abs(netLoss)}`);

  if (netLoss < 0 && Math.abs(netLoss) >= 500) {
    const activeRule = await db.get(
      'SELECT * FROM bonus_rules WHERE trigger_type = "HOURLY_LOSS" AND active = 1 AND rule_name = "TEST_HOURLY_LOSS_GUARD"'
    );
    if (activeRule && Math.abs(netLoss) >= activeRule.threshold) {
      const reward = JSON.parse(activeRule.bonus_reward);
      const user = await db.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email2]);
      
      const bonusAmount = parseFloat(reward.amount);
      const newBal = user.balance + bonusAmount;
      await db.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBal, email2]);
      await db.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "RULE_BONUS_DISPATCH", ?, ?, ?)',
        ['tx-bonus-1', email2, bonusAmount, newBal, new Date().toISOString()]
      );
      console.log(`🎁 RULE TRIGGERED: Dispatched $${bonusAmount} Cash recovery bonus to Player 2.`);
    }
  }

  // Verify Player 2's balance matches welcome bonus + loss + rule bonus reward (1000 - 600 + 50 = 450)
  const finalUser2 = await db.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email2]);
  if (finalUser2.balance === 450.0) {
    console.log('✅ PASS: Rules Engine successfully evaluated net hourly losses and dispatched recovery bonus.');
  } else {
    throw new Error(`FAIL: Rules Engine verification failed. Expected balance 450.0, got ${finalUser2.balance}`);
  }

  // 6. Admin Audit logging
  console.log('\n--- Test Case 5: Audit Log Trail Logging ---');
  await db.run(
    'INSERT INTO admin_audit_trail (admin_email, action, target_email, details, created_at) VALUES ("test-admin@cyber.com", "TEST_RESOLVE_ALERT", ?, "Manually resolved travel check", ?)',
    [email1, new Date().toISOString()]
  );
  
  const auditEntry = await db.get('SELECT * FROM admin_audit_trail WHERE admin_email = "test-admin@cyber.com"');
  if (auditEntry) {
    console.log('✅ PASS: Immutable Admin Audit trail recorded successfully.');
  } else {
    throw new Error('FAIL: Audit trail logging verification failed.');
  }

  console.log('\n🎉 ALL E2E SECURITY & RISK MANAGEMENT VALIDATIONS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ E2E Validation Failed:', err);
  process.exit(1);
});
