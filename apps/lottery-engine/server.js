const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const geoip = require('geoip-lite');
const { db, pubsub } = require('@cyber-casino/shared');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'cyber-casino-secret-key-1337-punk';
const localBlacklist = new Set();

const isJtiBlacklisted = async (jti) => {
  if (pubsub.isRedisConnected && pubsub.redisPublisher) {
    try {
      const val = await pubsub.redisPublisher.get(`blacklist:${jti}`);
      return val !== null;
    } catch (e) {
      return localBlacklist.has(jti);
    }
  }
  return localBlacklist.has(jti);
};

const blacklistJti = async (jti, exp) => {
  const ttl = Math.max(0, exp - Math.floor(Date.now() / 1000));
  if (pubsub.isRedisConnected && pubsub.redisPublisher) {
    try {
      await pubsub.redisPublisher.set(`blacklist:${jti}`, 'true', 'EX', ttl || 86400);
    } catch (e) {
      localBlacklist.add(jti);
      setTimeout(() => localBlacklist.delete(jti), (ttl || 86400) * 1000);
    }
  } else {
    localBlacklist.add(jti);
    setTimeout(() => localBlacklist.delete(jti), (ttl || 86400) * 1000);
  }
};

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Missing token.' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const isBlacklisted = await isJtiBlacklisted(decoded.jti);
    if (isBlacklisted) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Session revoked.' });
    }

    const user = await db.get('SELECT status FROM users WHERE LOWER(email) = ?', [decoded.email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized: User not found.' });
    }
    if (user.status === 'FROZEN' || user.status === 'BANNED') {
      return res.status(403).json({ success: false, error: `Account is ${user.status}.` });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token.' });
  }
};

let isKillSwitchActive = false;

// Generate unique transaction IDs
const generateTxId = () => {
  return 'TX-' + crypto.randomBytes(4).toString('hex').toUpperCase();
};

// 1. WebSocket / PubSub Kill Switch listener
pubsub.on('message', (message) => {
  if (message && message.type === 'KILL_SWITCH') {
    isKillSwitchActive = message.active;
    console.log(`[LOTTERY ENGINE] Kill-switch status updated via Pub/Sub: ${isKillSwitchActive}`);
  }
});

// Middleware to enforce Kill-Switch on ticket buying
const checkKillSwitch = (req, res, next) => {
  if (isKillSwitchActive) {
    return res.status(403).json({ 
      success: false, 
      error: 'Draw operations are currently disabled by administrator.' 
    });
  }
  next();
};

const logSessionAndCheckAlerts = async (email, ip, userAgent, deviceFingerprint, mockGeo = null) => {
  try {
    let country = 'LK', city = 'Colombo', lat = 6.9271, lon = 79.8612;
    
    // Check geoip
    const geo = geoip.lookup(ip);
    if (geo) {
      country = geo.country || 'Unknown';
      city = geo.city || 'Unknown';
      lat = geo.ll[0];
      lon = geo.ll[1];
    } else if (mockGeo) {
      country = mockGeo.country || country;
      city = mockGeo.city || city;
      lat = mockGeo.lat !== undefined ? mockGeo.lat : lat;
      lon = mockGeo.lon !== undefined ? mockGeo.lon : lon;
    }

    const now = new Date().toISOString();

    // Check last session for Impossible Travel
    const lastSession = await db.get(
      'SELECT * FROM user_session_logs WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 1',
      [email.toLowerCase()]
    );

    if (lastSession) {
      const distKm = getDistanceFromLatLonInKm(lastSession.latitude, lastSession.longitude, lat, lon);
      const timeHours = (new Date(now) - new Date(lastSession.created_at)) / 3600000;

      if (distKm > 10 && timeHours > 0) {
        const speed = distKm / timeHours;
        if (speed > 1000) {
          await db.run(
            'INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, "IMPOSSIBLE_TRAVEL", "HIGH", ?, 0, ?)',
            [
              email.toLowerCase(),
              `Impossible Travel detected: moved ${distKm.toFixed(0)} km in ${(timeHours * 60).toFixed(1)} mins (speed: ${speed.toFixed(0)} km/h). Last: ${lastSession.city}, ${lastSession.country}. Current: ${city}, ${country}.`,
              now
            ]
          );

          await db.run('UPDATE users SET status = "FROZEN" WHERE LOWER(email) = ?', [email.toLowerCase()]);
          console.warn(`[SECURITY] Account ${email} frozen due to Impossible Travel.`);
        }
      }
    }

    await db.run(
      'INSERT INTO user_session_logs (email, ip_address, user_agent, device_fingerprint, country, city, latitude, longitude, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [email.toLowerCase(), ip, userAgent, deviceFingerprint, country, city, lat, lon, now]
    );

    const sameIpUsers = await db.all(
      'SELECT DISTINCT LOWER(email) as email FROM user_session_logs WHERE ip_address = ? AND LOWER(email) != ?',
      [ip, email.toLowerCase()]
    );

    const sameFingerprintUsers = await db.all(
      'SELECT DISTINCT LOWER(email) as email FROM user_session_logs WHERE device_fingerprint = ? AND LOWER(email) != ?',
      [deviceFingerprint, email.toLowerCase()]
    );

    if (sameIpUsers.length > 0 || sameFingerprintUsers.length > 0) {
      const matchEmails = new Set();
      sameIpUsers.forEach(u => matchEmails.add(u.email));
      sameFingerprintUsers.forEach(u => matchEmails.add(u.email));

      if (matchEmails.size > 0) {
        await db.run(
          'INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, "MULTI_ACCOUNT", "MEDIUM", ?, 0, ?)',
          [
            email.toLowerCase(),
            `Shared footprint matches: ${Array.from(matchEmails).join(', ')} (Matching IP: ${sameIpUsers.length > 0}, Matching Fingerprint: ${sameFingerprintUsers.length > 0})`,
            now
          ]
        );
      }
    }

  } catch (err) {
    console.error('[SECURITY] Error running security rules:', err);
  }
};

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2-lat1);
  const dLon = deg2rad(lon2-lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const d = R * c; 
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// ============================================================================
// REST API ENDPOINTS
// ============================================================================

// --- Authentication ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, deviceFingerprint } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await db.get(
      'SELECT email, username, balance, gamesPlayed, totalWon, role, status FROM users WHERE LOWER(email) = ? AND password = ?',
      [email.toLowerCase(), password]
    );

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid email or password credentials.' });
    }

    if (user.status === 'FROZEN' || user.status === 'BANNED') {
      return res.status(403).json({ success: false, error: `Account is ${user.status}.` });
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    let mockGeo = null;
    if (req.headers['x-mock-ip-country']) {
      mockGeo = {
        country: req.headers['x-mock-ip-country'],
        city: req.headers['x-mock-ip-city'] || 'Unknown',
        lat: parseFloat(req.headers['x-mock-ip-lat']),
        lon: parseFloat(req.headers['x-mock-ip-lon'])
      };
    }

    await logSessionAndCheckAlerts(user.email, ip, userAgent, deviceFingerprint || 'unknown-fingerprint', mockGeo);

    // Re-fetch status AFTER session log (impossible travel may have just frozen the account)
    const freshStatus = await db.get('SELECT status FROM users WHERE LOWER(email) = ?', [user.email.toLowerCase()]);
    if (freshStatus && (freshStatus.status === 'FROZEN' || freshStatus.status === 'BANNED')) {
      return res.status(403).json({ success: false, error: `Account is ${freshStatus.status}. Login blocked by security system.` });
    }

    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { email: user.email, username: user.username, role: user.role, jti },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ success: true, user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, referralCode, deviceFingerprint, walletAddress } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All registration fields are required.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      // Check users table
      const existing = await tx.get('SELECT email FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (existing) {
        throw new Error('Email address is already registered.');
      }

      // Also check for orphaned referral code row (from a previous failed attempt)
      const orphanRef = await tx.get('SELECT email FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (orphanRef) {
        // Clean up orphaned row before re-inserting
        await tx.run('DELETE FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
        await tx.run('DELETE FROM user_affiliate_wallets WHERE LOWER(email) = ?', [email.toLowerCase()]);
      }

      const ownReferralCode = 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase();

      let referrerEmail = null;
      if (referralCode) {
        const referrer = await tx.get('SELECT email FROM user_referral_codes WHERE LOWER(referral_code) = ?', [referralCode.toLowerCase()]);
        if (referrer) {
          referrerEmail = referrer.email;
        }
      }

      await tx.run(
        'INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, status, wallet_address) VALUES (?, ?, ?, 1000.0, 0, 0.0, "ACTIVE", ?)',
        [email.toLowerCase(), username, password, walletAddress || null]
      );

      // Use INSERT OR REPLACE as safety net against constraint errors
      await tx.run(
        'INSERT OR REPLACE INTO user_referral_codes (email, referral_code, referred_by) VALUES (?, ?, ?)',
        [email.toLowerCase(), ownReferralCode, referrerEmail]
      );

      await tx.run(
        'INSERT OR IGNORE INTO user_affiliate_wallets (email, commission_balance, total_network_volume, current_rank) VALUES (?, 0.0, 0.0, "BRONZE")',
        [email.toLowerCase()]
      );

      if (referrerEmail) {
        const referralId = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        await tx.run(
          'INSERT OR IGNORE INTO referrals (id, referrer_email, referee_email, status, created_at) VALUES (?, ?, ?, "PENDING", ?)',
          [referralId, referrerEmail, email.toLowerCase(), new Date().toISOString()]
        );
      }

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, 1000.0, 1000.0, ?)',
        [txId, email.toLowerCase(), 'WELCOME_BONUS', new Date().toISOString()]
      );

      return { email: email.toLowerCase(), username, balance: 1000.0, gamesPlayed: 0, totalWon: 0.0, role: 'USER' };
    });

    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    let mockGeo = null;
    if (req.headers['x-mock-ip-country']) {
      mockGeo = {
        country: req.headers['x-mock-ip-country'],
        city: req.headers['x-mock-ip-city'] || 'Unknown',
        lat: parseFloat(req.headers['x-mock-ip-lat']),
        lon: parseFloat(req.headers['x-mock-ip-lon'])
      };
    }

    // Log session BEFORE signing token so travel-freeze is reflected in the token check
    await logSessionAndCheckAlerts(result.email, ip, userAgent, deviceFingerprint || 'unknown-fingerprint', mockGeo);

    // Re-fetch status in case logSession just froze the account
    const freshUser = await db.get('SELECT status FROM users WHERE LOWER(email) = ?', [result.email]);
    if (freshUser && (freshUser.status === 'FROZEN' || freshUser.status === 'BANNED')) {
      return res.status(403).json({ success: false, error: `Account flagged and ${freshUser.status} during registration security check.` });
    }

    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { email: result.email, username: result.username, role: result.role, jti },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ success: true, user: result, token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ success: false, error: error.message || 'Registration failed.' });
  }
});

// --- Referral & Affiliate Helpers ---

const checkAndTriggerBounty = async (email, tx) => {
  try {
    const referral = await tx.get(
      'SELECT id, referrer_email, referee_email, status FROM referrals WHERE LOWER(referee_email) = ? AND status = "PENDING"',
      [email.toLowerCase()]
    );
    if (!referral) return;

    const configs = await tx.all('SELECT * FROM affiliate_config');
    const configMap = {};
    configs.forEach(c => configMap[c.key] = c.value);

    const minDeposit = parseFloat(configMap.min_deposit_threshold) || 15;
    const minWager = parseFloat(configMap.min_wager_threshold) || 50;
    const referrerBounty = parseFloat(configMap.bounty_referrer_amount) || 10;
    const refereeBounty = 10.0;

    const depositSum = await tx.get(
      "SELECT SUM(amount) as total FROM transactions WHERE LOWER(email) = ? AND type = 'DEPOSIT'",
      [email.toLowerCase()]
    );
    const totalDeposits = depositSum ? parseFloat(depositSum.total || 0) : 0;

    const wagerSum = await tx.get(
      "SELECT ABS(SUM(amount)) as total FROM transactions WHERE LOWER(email) = ? AND type IN ('DICE_PLAY', 'SLOTS_PLAY', 'CRASH_PLAY', 'PLINKO_DROP', 'LOTTERY_PLAY')",
      [email.toLowerCase()]
    );
    const totalWagers = wagerSum ? parseFloat(wagerSum.total || 0) : 0;
    if (totalDeposits >= minDeposit || totalWagers >= minWager) {
      await tx.run(
        'UPDATE referrals SET status = "BOUNTY_CLAIMED", bounty_claimed_at = ? WHERE id = ?',
        [new Date().toISOString(), referral.id]
      );

      const referrerUser = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [referral.referrer_email.toLowerCase()]);
      if (referrerUser) {
        const newReferrerBalance = referrerUser.balance + referrerBounty;
        await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newReferrerBalance, referral.referrer_email.toLowerCase()]);

        const referrerTxId = generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "REFERRAL_BOUNTY", ?, ?, ?)',
          [referrerTxId, referral.referrer_email.toLowerCase(), referrerBounty, newReferrerBalance, new Date().toISOString()]
        );
      }

      const refereeUser = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (refereeUser) {
        const newRefereeBalance = refereeUser.balance + refereeBounty;
        await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newRefereeBalance, email.toLowerCase()]);

        const refereeTxId = generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "REFEREE_WELCOME_BONUS", ?, ?, ?)',
          [refereeTxId, email.toLowerCase(), refereeBounty, newRefereeBalance, new Date().toISOString()]
        );
      }

      console.log(`[AFFILIATE ENGINE] Two-sided Bounty qualified and paid out for Referee: ${email} -> Referrer: ${referral.referrer_email}`);
    }
  } catch (err) {
    console.error('Error triggering bounty:', err);
  }
};

const routeWagerCommission = async (refereeEmail, wagerAmount, gameType, tx) => {
  try {
    // 1. Emit WAGER_PROCESSED for gamification workers
    await pubsub.publish({
      type: 'WAGER_PROCESSED',
      email: refereeEmail.toLowerCase(),
      wagerAmount,
      gameType
    });

    // 2. Evaluate loss recovery bonus rules
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    
    // Check if a recovery bonus was already dispatched in the last hour
    const recentBonus = await tx.get(
      "SELECT COUNT(*) as count FROM transactions WHERE LOWER(email) = ? AND type = 'RULE_BONUS_DISPATCH' AND timestamp >= ?",
      [refereeEmail.toLowerCase(), oneHourAgo]
    );

    if (recentBonus && parseInt(recentBonus.count || 0, 10) === 0) {
      // Calculate net loss in last hour
      const lossRow = await tx.get(
        "SELECT SUM(amount) as net FROM transactions WHERE LOWER(email) = ? AND timestamp >= ?",
        [refereeEmail.toLowerCase(), oneHourAgo]
      );
      const netLoss = lossRow && lossRow.net ? parseFloat(lossRow.net) : 0.0;

      // Net loss is overall negative balance changes in transactions
      if (netLoss < 0 && Math.abs(netLoss) >= 500) {
        // Fetch active HOURLY_LOSS rules
        const activeRule = await tx.get(
          "SELECT * FROM bonus_rules WHERE trigger_type = 'HOURLY_LOSS' AND active = 1 ORDER BY threshold DESC LIMIT 1"
        );
        if (activeRule && Math.abs(netLoss) >= activeRule.threshold) {
          const reward = JSON.parse(activeRule.bonus_reward);
          const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [refereeEmail.toLowerCase()]);
          
          if (user) {
            let bonusAmount = 0;
            if (reward.type === 'CASH') {
              bonusAmount = parseFloat(reward.amount);
            } else if (reward.type === 'FREE_DROPS') {
              bonusAmount = parseFloat(reward.amount) * 1.5;
            }
            
            const newBal = user.balance + bonusAmount;
            await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBal, refereeEmail.toLowerCase()]);

            const txId = generateTxId();
            await tx.run(
              "INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'RULE_BONUS_DISPATCH', ?, ?, ?)",
              [txId, refereeEmail.toLowerCase(), bonusAmount, newBal, new Date().toISOString()]
            );

            console.log(`[BONUS RULES] Dispatched bonus for ${refereeEmail}: $${bonusAmount} (Hourly net loss was: $${Math.abs(netLoss)})`);
          }
        }
      }
    }

    const referral = await tx.get('SELECT referred_by FROM user_referral_codes WHERE LOWER(email) = ?', [refereeEmail.toLowerCase()]);
    if (!referral || !referral.referred_by) return;

    const referrerEmail = referral.referred_by;

    const configs = await tx.all('SELECT * FROM affiliate_config');
    const configMap = {};
    configs.forEach(c => configMap[c.key] = c.value);

    const wagerCommissionEnabled = configMap.wager_commission_enabled === 'true';

    let houseEdge = 0.05; 
    if (gameType === 'CRASH') {
      const crashHouseEdge = await tx.get("SELECT value FROM crash_config WHERE key = 'house_edge'");
      houseEdge = crashHouseEdge ? parseFloat(crashHouseEdge.value) : 0.01;
    } else if (gameType === 'DICE') {
      houseEdge = 0.023;
    } else if (gameType === 'SLOTS') {
      const slotsHouseEdge = await tx.get("SELECT value FROM slots_config WHERE key = 'target_rtp'");
      houseEdge = slotsHouseEdge ? (1.0 - parseFloat(slotsHouseEdge.value)) : 0.10;
    } else if (gameType === 'PLINKO') {
      const plinkoHouseEdge = await tx.get("SELECT value FROM plinko_config WHERE key = 'house_edge'");
      houseEdge = plinkoHouseEdge ? parseFloat(plinkoHouseEdge.value) : 0.05;
    }

    const referrerWallet = await tx.get('SELECT total_network_volume, commission_balance FROM user_affiliate_wallets WHERE LOWER(email) = ?', [referrerEmail.toLowerCase()]);
    if (!referrerWallet) return;

    let rankMultiplier = 0.05;
    const currentVol = referrerWallet.total_network_volume;

    const bronzeMult = parseFloat(configMap.rank_bronze_multiplier) || 0.05;
    const silverMult = parseFloat(configMap.rank_silver_multiplier) || 0.10;
    const goldMult = parseFloat(configMap.rank_gold_multiplier) || 0.15;
    const diamondMult = parseFloat(configMap.rank_diamond_multiplier) || 0.25;

    const silverVol = parseFloat(configMap.rank_silver_volume) || 1000;
    const goldVol = parseFloat(configMap.rank_gold_volume) || 10000;
    const diamondVol = parseFloat(configMap.rank_diamond_volume) || 100000;

    let currentRank = 'BRONZE';
    if (currentVol >= diamondVol) {
      rankMultiplier = diamondMult;
      currentRank = 'DIAMOND';
    } else if (currentVol >= goldVol) {
      rankMultiplier = goldMult;
      currentRank = 'GOLD';
    } else if (currentVol >= silverVol) {
      rankMultiplier = silverMult;
      currentRank = 'SILVER';
    } else {
      rankMultiplier = bronzeMult;
      currentRank = 'BRONZE';
    }

    const potentialCommission = wagerAmount * houseEdge * rankMultiplier;

    if (!wagerCommissionEnabled) {
      await tx.run(
        'INSERT INTO shadow_commission_logs (referee_email, referrer_email, wager_amount, potential_commission, timestamp) VALUES (?, ?, ?, ?, ?)',
        [refereeEmail.toLowerCase(), referrerEmail.toLowerCase(), wagerAmount, potentialCommission, new Date().toISOString()]
      );
      console.log(`[AFFILIATE SHADOW MODE] Logged potential commission for ${referrerEmail}: $${potentialCommission}`);
    } else {
      const newCommissionBalance = referrerWallet.commission_balance + potentialCommission;
      const newNetworkVolume = currentVol + wagerAmount;

      let nextRank = 'BRONZE';
      if (newNetworkVolume >= diamondVol) nextRank = 'DIAMOND';
      else if (newNetworkVolume >= goldVol) nextRank = 'GOLD';
      else if (newNetworkVolume >= silverVol) nextRank = 'SILVER';

      await tx.run(
        'UPDATE user_affiliate_wallets SET commission_balance = ?, total_network_volume = ?, current_rank = ? WHERE LOWER(email) = ?',
        [newCommissionBalance, newNetworkVolume, nextRank, referrerEmail.toLowerCase()]
      );

      console.log(`[AFFILIATE ACTIVE MODE] Commission paid to ${referrerEmail}: $${potentialCommission} (Rank: ${nextRank})`);
    }
  } catch (err) {
    console.error('Error routing commission:', err);
  }
};

// --- Affiliate Player APIs ---

app.get('/api/affiliate/stats', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    let userRef = await db.get('SELECT referral_code FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!userRef) {
      // Lazily sign up user for affiliate program if they don't have a profile yet
      const ownReferralCode = 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      await db.executeTransaction(async (tx) => {
        const innerRef = await tx.get('SELECT referral_code FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
        if (!innerRef) {
          await tx.run(
            'INSERT INTO user_referral_codes (email, referral_code, referred_by) VALUES (?, ?, NULL)',
            [email.toLowerCase(), ownReferralCode]
          );
          await tx.run(
            'INSERT INTO user_affiliate_wallets (email, commission_balance, total_network_volume, current_rank) VALUES (?, 0.0, 0.0, "BRONZE")',
            [email.toLowerCase()]
          );
        }
      });
      userRef = await db.get('SELECT referral_code FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
    }

    const wallet = await db.get('SELECT * FROM user_affiliate_wallets WHERE LOWER(email) = ?', [email.toLowerCase()]);
    const referrals = await db.all('SELECT referee_email, status, created_at FROM referrals WHERE LOWER(referrer_email) = ?', [email.toLowerCase()]);

    res.json({
      success: true,
      referralCode: userRef ? userRef.referral_code : '',
      commissionBalance: wallet ? wallet.commission_balance : 0.0,
      totalNetworkVolume: wallet ? wallet.total_network_volume : 0.0,
      currentRank: wallet ? wallet.current_rank : 'BRONZE',
      referrals
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/affiliate/claim-commission', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    const result = await db.executeTransaction(async (tx) => {
      const wallet = await tx.get('SELECT commission_balance FROM user_affiliate_wallets WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!wallet || wallet.commission_balance <= 0) {
        throw new Error('No commission earnings available to claim.');
      }

      const claimAmount = wallet.commission_balance;
      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      const newBalance = user.balance + claimAmount;

      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBalance, email.toLowerCase()]);
      await tx.run('UPDATE user_affiliate_wallets SET commission_balance = 0.0 WHERE LOWER(email) = ?', [email.toLowerCase()]);

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "AFFILIATE_CLAIM", ?, ?, ?)',
        [txId, email.toLowerCase(), claimAmount, newBalance, new Date().toISOString()]
      );

      return { newBalance, claimed: claimAmount };
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- Plinko Engine Mappings & Cryptographic Logic ---
const PLINKO_MULTIPLIERS = {
  8: {
    Low: [5.6, 1.6, 1.1, 1.0, 0.4, 1.0, 1.1, 1.6, 5.6],
    Medium: [13, 3, 1.3, 0.7, 0.1, 0.7, 1.3, 3, 13],
    High: [29, 4, 1.5, 0.3, 0.0, 0.3, 1.5, 4, 29]
  },
  9: {
    Low: [5.6, 2.0, 1.6, 1.0, 0.5, 0.5, 1.0, 1.6, 2.0, 5.6],
    Medium: [18, 4, 1.7, 0.9, 0.2, 0.2, 0.9, 1.7, 4, 18],
    High: [43, 7, 2.0, 0.6, 0.0, 0.0, 0.6, 2.0, 7, 43]
  },
  10: {
    Low: [8.9, 3.0, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 3.0, 8.9],
    Medium: [22, 5, 2.0, 1.4, 0.5, 0.1, 0.5, 1.4, 2.0, 5, 22],
    High: [76, 10, 3.0, 0.9, 0.2, 0.0, 0.2, 0.9, 3.0, 10, 76]
  },
  11: {
    Low: [8.9, 3.0, 1.7, 1.1, 1.0, 0.6, 0.6, 1.0, 1.1, 1.7, 3.0, 8.9],
    Medium: [24, 6, 3.0, 1.8, 0.5, 0.2, 0.2, 0.5, 1.8, 3.0, 6, 24],
    High: [120, 14, 4.3, 1.4, 0.2, 0.0, 0.0, 0.2, 1.4, 4.3, 14, 120]
  },
  12: {
    Low: [10, 4.0, 2.0, 1.6, 1.1, 1.0, 0.5, 1.0, 1.1, 1.6, 2.0, 4.0, 10],
    Medium: [33, 11, 4.0, 2.0, 1.1, 0.4, 0.1, 0.4, 1.1, 2.0, 4.0, 11, 33],
    High: [170, 24, 8.1, 2.0, 0.5, 0.1, 0.0, 0.1, 0.5, 2.0, 8.1, 24, 170]
  },
  13: {
    Low: [10, 4.0, 2.0, 1.6, 1.2, 1.0, 0.6, 0.6, 1.0, 1.2, 1.6, 2.0, 4.0, 10],
    Medium: [43, 13, 6.0, 3.0, 1.3, 0.5, 0.2, 0.2, 0.5, 1.3, 3.0, 6.0, 13, 43],
    High: [260, 37, 11, 4.0, 1.0, 0.1, 0.0, 0.0, 0.1, 1.0, 4.0, 11, 37, 260]
  },
  14: {
    Low: [16, 7.0, 4.0, 1.9, 1.4, 1.0, 0.5, 0.5, 0.5, 1.0, 1.4, 1.9, 4.0, 7.0, 16],
    Medium: [58, 15, 7.0, 4.0, 1.9, 1.0, 0.4, 0.1, 0.4, 1.0, 1.9, 4.0, 7.0, 15, 58],
    High: [420, 56, 18, 5.0, 1.9, 0.2, 0.0, 0.0, 0.0, 0.2, 1.9, 5.0, 18, 56, 420]
  },
  15: {
    Low: [16, 7.0, 4.0, 1.9, 1.4, 1.1, 1.0, 0.6, 0.6, 1.0, 1.1, 1.4, 1.9, 4.0, 7.0, 16],
    Medium: [88, 18, 9.0, 5.0, 2.5, 1.3, 0.4, 0.1, 0.1, 0.4, 1.3, 2.5, 5.0, 9.0, 18, 88],
    High: [620, 83, 27, 8.0, 3.0, 0.5, 0.1, 0.0, 0.0, 0.1, 0.5, 3.0, 8.0, 27, 83, 620]
  },
  16: {
    Low: [16, 9.0, 2.0, 1.4, 1.3, 1.1, 1.0, 0.5, 0.5, 0.5, 1.0, 1.1, 1.3, 1.4, 2.0, 9.0, 16],
    Medium: [110, 41, 10, 5.0, 3.0, 1.5, 1.0, 0.3, 0.1, 0.3, 1.0, 1.5, 3.0, 5.0, 10, 41, 110],
    High: [1000, 130, 26, 9.0, 4.0, 2.0, 0.2, 0.0, 0.0, 0.0, 0.2, 2.0, 4.0, 9.0, 26, 130, 1000]
  }
};

const generatePlinkoPath = (serverSeed, clientSeed, nonce, rows, biasFactor = 8, throwOutChance = 0.02) => {
  const combined = `${serverSeed}:${clientSeed}:${nonce}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  
  const firstByte = parseInt(hash.substring(0, 2), 16);
  const isThrowOut = (firstByte % 100) < (throwOutChance * 100);
  const pathSteps = [];

  if (isThrowOut) {
    const throwDir = (firstByte & 1); // 0 = Left, 1 = Right
    for (let r = 0; r < rows; r++) {
      if (r < 2) {
        const hexByte = hash.substring(r * 2 + 2, r * 2 + 4);
        const byteVal = parseInt(hexByte, 16);
        pathSteps.push(byteVal >= 128 ? 1 : 0);
      } else {
        pathSteps.push(throwDir);
      }
    }
    const destinationBin = throwDir === 1 ? 999 : -1;
    return { path: pathSteps, destinationBin };
  }

  let rightCount = 0;
  let leftCount = 0;

  for (let r = 0; r < rows; r++) {
    const currentX = rightCount - leftCount;
    let threshold = 128 + currentX * biasFactor;
    threshold = Math.max(15, Math.min(240, threshold));

    const hexByte = hash.substring(r * 2, r * 2 + 2);
    const byteVal = parseInt(hexByte, 16);
    const step = byteVal >= threshold ? 1 : 0;
    
    pathSteps.push(step);
    if (step === 1) {
      rightCount++;
    } else {
      leftCount++;
    }
  }

  return { path: pathSteps, destinationBin: rightCount };
};

// --- Plinko API Endpoints ---
app.post('/api/plinko/drop', requireAuth, async (req, res) => {
  try {
    const { email, wagerAmount, rows, risk } = req.body;

    if (!email || !wagerAmount || !rows || !risk) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const wager = parseFloat(wagerAmount);
    const rowCount = parseInt(rows, 10);

    if (isNaN(wager) || wager <= 0) {
      return res.status(400).json({ success: false, error: 'Wager amount must be positive.' });
    }
    if (rowCount < 8 || rowCount > 16) {
      return res.status(400).json({ success: false, error: 'Rows must be between 8 and 16.' });
    }
    if (!['Low', 'Medium', 'High'].includes(risk)) {
      return res.status(400).json({ success: false, error: 'Invalid risk tier.' });
    }

    // Load configs
    const configs = await db.all('SELECT * FROM plinko_config');
    const configMap = {};
    configs.forEach(c => configMap[c.key] = c.value);

    const minBet = parseFloat(configMap.min_bet) || 1;
    const maxBet = parseFloat(configMap.max_bet) || 1000;
    const biasFactor = configMap.rtp_bias !== undefined ? parseInt(configMap.rtp_bias, 10) : 8;
    const throwOutChance = configMap.throw_out_chance !== undefined ? parseFloat(configMap.throw_out_chance) : 0.02;

    if (wager < minBet || wager > maxBet) {
      return res.status(400).json({ success: false, error: `Wager must be between $${minBet} and $${maxBet}.` });
    }

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) {
        throw new Error('User account not found.');
      }
      if (user.balance < wager) {
        throw new Error('Insufficient wallet balance.');
      }

      const lockedBalance = user.balance - wager;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [lockedBalance, user.gamesPlayed + 1, email.toLowerCase()]);

      const wagerTxId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [wagerTxId, email.toLowerCase(), 'PLINKO_DROP', -wager, lockedBalance, new Date().toISOString()]
      );

      const serverSeed = crypto.randomBytes(32).toString('hex');
      const clientSeed = crypto.randomBytes(16).toString('hex');
      const nonce = user.gamesPlayed + 1;

      const { path: dropPath, destinationBin } = generatePlinkoPath(serverSeed, clientSeed, nonce, rowCount, biasFactor, throwOutChance);

      let multiplier = 0;
      let payout = 0;
      
      if (destinationBin === -1 || destinationBin === 999) {
        multiplier = 0.0;
        payout = 0.0;
      } else {
        multiplier = PLINKO_MULTIPLIERS[rowCount][risk][destinationBin];
        payout = wager * multiplier;
      }
      
      const finalBalance = lockedBalance + payout;

      await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [finalBalance, user.totalWon + payout, email.toLowerCase()]);

      if (payout > 0) {
        const payoutTxId = generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [payoutTxId, email.toLowerCase(), 'PLINKO_WINOUT', payout, finalBalance, new Date().toISOString()]
        );
      }

      await tx.run(
        'INSERT INTO plinko_drops (email, wager_amount, rows, risk, path, destination_bin, multiplier, payout, server_seed, client_seed, nonce, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [email.toLowerCase(), wager, rowCount, risk, JSON.stringify(dropPath), destinationBin, multiplier, payout, serverSeed, clientSeed, nonce, new Date().toISOString()]
      );

      // Route wager commission & trigger bounty check
      await routeWagerCommission(email, wager, 'PLINKO', tx);
      await checkAndTriggerBounty(email, tx);

      return {
        path: dropPath,
        multiplier,
        payout,
        newBalance: finalBalance,
        serverSeed,
        clientSeed,
        nonce,
        destinationBin
      };
    });

    res.json({ success: true, ...result });

  } catch (error) {
    console.error('Plinko drop error:', error);
    res.status(400).json({ success: false, error: error.message || 'Server error' });
  }
});

app.get('/api/plinko/history', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email parameter missing' });
    }

    const history = await db.all(
      'SELECT id, wager_amount, rows, risk, multiplier, payout, timestamp FROM plinko_drops WHERE LOWER(email) = ? ORDER BY timestamp DESC LIMIT 20',
      [email.toLowerCase()]
    );

    res.json({ success: true, history });
  } catch (error) {
    console.error('Plinko history error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// --- Wallet & Balance Info ---
app.get('/api/user/wallet', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const user = await db.get('SELECT balance, wallet_address FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const transactions = await db.all(
      'SELECT id, type, amount, balanceAfter, timestamp FROM transactions WHERE LOWER(email) = ? ORDER BY timestamp DESC LIMIT 50',
      [email.toLowerCase()]
    );

    res.json({ success: true, balance: user.balance, walletAddress: user.wallet_address, transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/user/wallet-address', requireAuth, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const email = req.user.email;
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'Wallet address is required.' });
    }

    await db.run('UPDATE users SET wallet_address = ? WHERE LOWER(email) = ?', [walletAddress, email.toLowerCase()]);

    const duplicate = await db.all(
      'SELECT LOWER(email) as email FROM users WHERE wallet_address = ? AND LOWER(email) != ?',
      [walletAddress, email.toLowerCase()]
    );

    if (duplicate.length > 0) {
      const matchEmails = duplicate.map(d => d.email).join(', ');
      await db.run(
        'INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, "MULTI_ACCOUNT", "MEDIUM", ?, 0, ?)',
        [
          email.toLowerCase(),
          `Shared withdrawal wallet address matched with: ${matchEmails}`,
          new Date().toISOString()
        ]
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/user/deposit', async (req, res) => {
  try {
    const { email, amount } = req.body;
    const depAmount = parseFloat(amount);
    if (!email || isNaN(depAmount) || depAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid deposit values.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');

      const newBalance = user.balance + depAmount;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBalance, email.toLowerCase()]);

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [txId, email.toLowerCase(), 'DEPOSIT', depAmount, newBalance, new Date().toISOString()]
      );

      // Trigger potential welcome bounty
      await checkAndTriggerBounty(email, tx);

      return newBalance;
    });

    res.json({ success: true, newBalance: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/user/withdraw', async (req, res) => {
  try {
    const { email, amount } = req.body;
    const witAmount = parseFloat(amount);
    if (!email || isNaN(witAmount) || witAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid withdrawal values.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < witAmount) throw new Error('Insufficient wallet balance.');

      const newBalance = user.balance - witAmount;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBalance, email.toLowerCase()]);

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [txId, email.toLowerCase(), 'WITHDRAWAL', -witAmount, newBalance, new Date().toISOString()]
      );

      return newBalance;
    });

    res.json({ success: true, newBalance: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Leaderboard ---
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await db.all(
      'SELECT username, gamesPlayed, totalWon FROM users ORDER BY totalWon DESC LIMIT 10'
    );
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Get all spin wheel prizes config for frontends
app.get('/api/spin-wheel/prizes', async (req, res) => {
  try {
    const prizes = await db.all('SELECT * FROM spin_wheel_prizes ORDER BY id ASC');
    res.json({
      success: true,
      prizes: prizes.map(p => ({
        id: p.id,
        text: p.text,
        color: p.color,
        textColor: p.textColor,
        mult: p.mult,
        isBonus: p.isBonus === 1
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// --- Spin Wheel Game ---
app.post('/api/spin', async (req, res) => {
  try {
    const { email } = req.body;
    const SPIN_COST = 10.0;

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < SPIN_COST) throw new Error('Insufficient wallet funds.');

      // 1. Deduct cost
      let balance = user.balance - SPIN_COST;
      const gamesPlayed = user.gamesPlayed + 1;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [balance, gamesPlayed, email.toLowerCase()]);
      
      const playTxId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [playTxId, email.toLowerCase(), 'SPIN_PLAY', -SPIN_COST, balance, new Date().toISOString()]
      );

      // 2. Compute Spin index dynamically from DB
      const dbPrizes = await tx.all('SELECT * FROM spin_wheel_prizes ORDER BY id ASC');
      const prizes = dbPrizes.length > 0 ? dbPrizes.map(p => ({
        text: p.text,
        mult: p.mult,
        isBonus: p.isBonus === 1
      })) : [
        { text: '10% CASHBACK', mult: 0.1, isBonus: true },
        { text: 'TRY AGAIN', mult: 0.0, isBonus: false },
        { text: 'FREE $10', mult: 1.0, isBonus: false },
        { text: 'NO LUCK', mult: 0.0, isBonus: false },
        { text: 'JACKPOT x5', mult: 5.0, isBonus: false },
        { text: '20% BONUS', mult: 0.2, isBonus: true }
      ];
      
      const winningIndex = crypto.randomInt(0, prizes.length);
      const prize = prizes[winningIndex];
      const payout = SPIN_COST * prize.mult;
      let totalWon = user.totalWon;

      if (payout > 0) {
        balance += payout;
        totalWon += payout;
        await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [balance, totalWon, email.toLowerCase()]);

        const winTxId = generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [winTxId, email.toLowerCase(), 'SPIN_WINOUT', payout, balance, new Date().toISOString()]
        );
      }

      return { winningIndex, prizeText: prize.text, newBalance: balance, gamesPlayed, totalWon };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Slots Game ---
app.get('/api/slots/config', async (req, res) => {
  try {
    const strategy = await db.get("SELECT value FROM slots_config WHERE key = 'payout_strategy'");
    const rtp = await db.get("SELECT value FROM slots_config WHERE key = 'target_rtp'");
    const symbols = await db.get("SELECT value FROM slots_config WHERE key = 'symbols_config'");

    res.json({
      success: true,
      config: {
        payout_strategy: strategy ? strategy.value : 'FAIR_RNG',
        target_rtp: rtp ? rtp.value : '0.90',
        symbols_config: symbols ? symbols.value : '[]'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/slots/spin', async (req, res) => {
  try {
    const { email, bet } = req.body;
    const betAmount = parseFloat(bet);
    if (!email || isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid slots bet details.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < betAmount) throw new Error('Insufficient wallet funds.');

      // 1. Deduct bet cost
      let balance = user.balance - betAmount;
      const gamesPlayed = user.gamesPlayed + 1;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [balance, gamesPlayed, email.toLowerCase()]);

      const playTxId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [playTxId, email.toLowerCase(), 'SLOTS_PLAY', -betAmount, balance, new Date().toISOString()]
      );

      // 2. Roll slots dynamically based on strategy & weights
      const strategyRow = await tx.get("SELECT value FROM slots_config WHERE key = 'payout_strategy'");
      const rtpRow = await tx.get("SELECT value FROM slots_config WHERE key = 'target_rtp'");
      const symbolsRow = await tx.get("SELECT value FROM slots_config WHERE key = 'symbols_config'");

      const strategy = strategyRow ? strategyRow.value : 'FAIR_RNG';
      const targetRtp = rtpRow ? parseFloat(rtpRow.value) : 0.90;
      const symbols = symbolsRow ? JSON.parse(symbolsRow.value) : [
        { name: 'BAR', multiplier: 3, weight: 30 },
        { name: 'CHERRY', multiplier: 5, weight: 25 },
        { name: 'BELL', multiplier: 10, weight: 20 },
        { name: 'DIAMOND', multiplier: 20, weight: 15 },
        { name: 'SEVEN', multiplier: 50, weight: 8 },
        { name: 'WILD', multiplier: 100, weight: 2 }
      ];

      // Reel rolling helper using configuration weights
      const rollReelsByWeights = (symbolsList) => {
        const totalWeight = symbolsList.reduce((acc, s) => acc + s.weight, 0);
        const rollOne = () => {
          let rand = crypto.randomInt(0, totalWeight);
          for (const s of symbolsList) {
            if (rand < s.weight) return s.name;
            rand -= s.weight;
          }
          return symbolsList[0].name;
        };
        return [rollOne(), rollOne(), rollOne()];
      };

      // Roll reels initially using Fair RNG (weighted probability)
      let reels = rollReelsByWeights(symbols);

      // Helper to calculate payout for a given reel outcome
      const calculatePayout = (outcome, symsList, betVal) => {
        if (outcome[0] === outcome[1] && outcome[1] === outcome[2]) {
          const multipliers = {};
          symsList.forEach(s => multipliers[s.name] = s.multiplier);
          return betVal * (multipliers[outcome[0]] || 0);
        }
        return 0;
      };

      let payout = calculatePayout(reels, symbols, betAmount);

      // --- Payout Strategies Override ---
      if (strategy === 'CONTROLLED_RTP') {
        const stats = await tx.get(`
          SELECT 
            ABS(SUM(CASE WHEN type = 'SLOTS_PLAY' THEN amount ELSE 0 END)) as totalBet,
            SUM(CASE WHEN type = 'SLOTS_WIN' THEN amount ELSE 0 END) as totalWon
          FROM transactions
          WHERE email = ?
        `, [email.toLowerCase()]);

        const totalBet = (stats ? stats.totalBet : 0) + betAmount;
        const totalWon = (stats ? stats.totalWon : 0) + payout;
        const currentRtp = totalBet > 0 ? (totalWon / totalBet) : 0;

        if (currentRtp > targetRtp && payout > betAmount * 2) {
          let attempts = 0;
          while (attempts < 20) {
            reels = rollReelsByWeights(symbols);
            payout = calculatePayout(reels, symbols, betAmount);
            if (payout <= betAmount * 2) break;
            attempts++;
          }
        }
      } else if (strategy === 'NEAR_MISS_TEASER') {
        if (payout === 0 && crypto.randomInt(0, 100) < 50) {
          const premiumSymbols = ['SEVEN', 'DIAMOND', 'BELL'];
          const targetSym = premiumSymbols[crypto.randomInt(0, premiumSymbols.length)];
          const otherSymbols = symbols.filter(s => s.name !== targetSym && s.name !== 'WILD');
          const finalOther = otherSymbols[crypto.randomInt(0, otherSymbols.length)].name;
          reels = [targetSym, targetSym, finalOther];
          reels.sort(() => 0.5 - Math.random());
          payout = 0;
        }
      }

      let totalWon = user.totalWon;
      if (payout > 0) {
        balance += payout;
        totalWon += payout;
        await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [balance, totalWon, email.toLowerCase()]);

        const winTxId = generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [winTxId, email.toLowerCase(), 'SLOTS_WINOUT', payout, balance, new Date().toISOString()]
        );
      }

      // Route wager commission & trigger bounty check
      await routeWagerCommission(email, betAmount, 'SLOTS', tx);
      await checkAndTriggerBounty(email, tx);

      return { reels, payout, newBalance: balance, gamesPlayed, totalWon };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Cyber Lottery Game ---
// Expose endpoints for buying tickets and checking status

// Dynamic Games Configurations are read from the database now.
app.get('/api/lottery/games', async (req, res) => {
  try {
    const games = await db.all("SELECT * FROM games_config WHERE status = 'ACTIVE'");
    res.json({ success: true, games });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.get('/api/lottery/status', async (req, res) => {
  try {
    const { email, lotteryName } = req.query;
    const name = lotteryName || 'Sugar Rush 15';
    
    // Fetch active draw (last draw row for this game)
    let currentDraw = await db.get(
      'SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1',
      [name]
    );
    
    if (!currentDraw) {
      // Auto-create draw if missing
      await db.run(
        'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
        [name, 'OPEN', new Date().toISOString()]
      );
      currentDraw = await db.get(
        'SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1',
        [name]
      );
    }

    let tickets = [];
    if (email) {
      // 1. Fetch tickets for active draw
      tickets = await db.all(
        'SELECT id, chosenNumbers, betAmount, claimed, payout, timestamp FROM lottery_tickets WHERE LOWER(email) = ? AND drawId = ? AND lotteryName = ? ORDER BY id DESC',
        [email.toLowerCase(), currentDraw.id, name]
      );

      // 2. Fallback to last completed draw if active draw has no tickets yet
      if (tickets.length === 0) {
        const lastCompletedDraw = await db.get(
          "SELECT id FROM lottery_draws WHERE lotteryName = ? AND state = 'COMPLETED' ORDER BY id DESC LIMIT 1",
          [name]
        );
        if (lastCompletedDraw) {
          tickets = await db.all(
            'SELECT id, chosenNumbers, betAmount, claimed, payout, timestamp FROM lottery_tickets WHERE LOWER(email) = ? AND drawId = ? AND lotteryName = ? ORDER BY id DESC',
            [email.toLowerCase(), lastCompletedDraw.id, name]
          );
        }
      }
    }

    res.json({ 
      success: true, 
      draw: {
        id: currentDraw.id,
        lotteryName: currentDraw.lotteryName,
        state: currentDraw.state,
        winningNumbers: currentDraw.winningNumbers ? JSON.parse(currentDraw.winningNumbers) : null,
        timestamp: currentDraw.timestamp
      },
      tickets: tickets.map(t => ({
        ...t,
        chosenNumbers: JSON.parse(t.chosenNumbers)
      }))
    });
  } catch (error) {
    console.error('Lottery status error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.get('/api/lottery/history', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email parameter is required.' });
    }

    // Query all tickets for the user across all games with draw winning numbers info
    const tickets = await db.all(`
      SELECT 
        t.id, 
        t.lotteryName, 
        t.drawId, 
        t.chosenNumbers, 
        t.betAmount, 
        t.claimed, 
        t.payout, 
        t.timestamp,
        d.winningNumbers,
        d.state as drawState
      FROM lottery_tickets t
      LEFT JOIN lottery_draws d ON t.drawId = d.id AND t.lotteryName = d.lotteryName
      WHERE LOWER(t.email) = ?
      ORDER BY t.id DESC
    `, [email.toLowerCase()]);

    // Parse chosen numbers and winning numbers
    const parsedTickets = tickets.map(t => ({
      id: t.id,
      lotteryName: t.lotteryName,
      drawId: t.drawId,
      chosenNumbers: JSON.parse(t.chosenNumbers),
      betAmount: t.betAmount,
      claimed: t.claimed,
      payout: t.payout,
      timestamp: t.timestamp,
      winningNumbers: t.winningNumbers ? JSON.parse(t.winningNumbers) : null,
      drawState: t.drawState
    }));

    res.json({ success: true, tickets: parsedTickets });
  } catch (error) {
    console.error('Error fetching ticket history:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get recent draws & winner aggregates for previous winners shelf
app.get('/api/lottery/winners/:gameName', async (req, res) => {
  try {
    const draws = await db.all(
      `SELECT d.id as drawId, d.winningNumbers, d.timestamp,
              (SELECT COUNT(*) FROM lottery_tickets WHERE drawId = d.id AND payout > 0) as winnersCount,
              (SELECT SUM(payout) FROM lottery_tickets WHERE drawId = d.id) as totalPaidOut
       FROM lottery_draws d
       WHERE d.lotteryName = ? AND d.state = 'COMPLETED'
       ORDER BY d.id DESC LIMIT 5`,
      [req.params.gameName]
    );

    const parsedDraws = draws.map(d => ({
      drawId: d.drawId,
      winningNumbers: d.winningNumbers ? JSON.parse(d.winningNumbers) : null,
      timestamp: d.timestamp,
      winnersCount: d.winnersCount || 0,
      totalPaidOut: d.totalPaidOut || 0.0
    }));

    res.json({ success: true, draws: parsedDraws });
  } catch (error) {
    console.error('Error fetching draws winners:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.get('/api/lottery/pool-tickets', async (req, res) => {
  try {
    const { email, lotteryName } = req.query;
    const name = lotteryName || 'Sugar Rush 15';

    // 1. Get active OPEN draw
    const draw = await db.get(
      "SELECT id FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? ORDER BY id DESC LIMIT 1",
      [name]
    );
    if (!draw) {
      return res.json({ success: true, tickets: [] }); // Sales currently locked
    }

    const nowIso = new Date().toISOString();

    // 2. Fetch 5 random tickets that are AVAILABLE or have EXPIRED reservations
    let poolTickets = await db.all(`
      SELECT * FROM lottery_ticket_pool 
      WHERE lotteryName = ? AND drawId = ? 
        AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reservedUntil < ?))
      ORDER BY RANDOM() LIMIT 5
    `, [name, draw.id, nowIso]);

    // If pool has fewer than 5 available tickets, auto-generate 100 fresh tickets to prevent empty screens
    if (poolTickets.length < 5) {
      console.log(`[LOTTERY ENGINE] Auto-generating ticket pool of 100 tickets for Draw ID ${draw.id} of ${name}...`);
      const totalTickets = 100;
      const pool = [];
      const generateUniqueNumbers = () => {
        const nums = new Set();
        while (nums.size < 6) {
          nums.add(Math.floor(Math.random() * 49) + 1);
        }
        return Array.from(nums).sort((a, b) => a - b);
      };

      for (let i = 0; i < totalTickets; i++) {
        pool.push(generateUniqueNumbers());
      }

      await db.executeTransaction(async (tx) => {
        for (const ticketNumbers of pool) {
          await tx.run(
            'INSERT INTO lottery_ticket_pool (lotteryName, drawId, chosenNumbers, status) VALUES (?, ?, ?, ?)',
            [name, draw.id, JSON.stringify(ticketNumbers), 'AVAILABLE']
          );
        }
      });

      // Refetch after generation
      poolTickets = await db.all(`
        SELECT * FROM lottery_ticket_pool 
        WHERE lotteryName = ? AND drawId = ? 
          AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reservedUntil < ?))
        ORDER BY RANDOM() LIMIT 5
      `, [name, draw.id, nowIso]);
    }

    const parsed = poolTickets.map(t => ({
      id: t.id,
      lotteryName: t.lotteryName,
      drawId: t.drawId,
      chosenNumbers: JSON.parse(t.chosenNumbers),
      status: t.status
    }));

    res.json({ success: true, tickets: parsed });
  } catch (error) {
    console.error('Error fetching pool tickets:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/lottery/reserve', checkKillSwitch, async (req, res) => {
  try {
    const { email, ticketId, ticketIds } = req.body;
    const ids = Array.isArray(ticketIds) ? ticketIds : (ticketId ? [ticketId] : []);
    if (!email || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing reservation parameters.' });
    }

    const nowIso = new Date().toISOString();
    const reservedUntil = new Date(Date.now() + 30000).toISOString(); // 30-Second Rule Lock

    const result = await db.executeTransaction(async (tx) => {
      // Find all tickets and check availability
      for (const id of ids) {
        const ticket = await tx.get(
          "SELECT * FROM lottery_ticket_pool WHERE id = ?",
          [id]
        );
        if (!ticket) throw new Error(`Ticket #${id} not found in pool.`);
        
        const isAvailable = ticket.status === 'AVAILABLE' || 
                            (ticket.status === 'RESERVED' && ticket.reservedUntil < nowIso);
        
        if (!isAvailable) {
          throw new Error(`Ticket #${id} has already been reserved by another player.`);
        }

        // Check draw state
        const draw = await tx.get("SELECT state FROM lottery_draws WHERE id = ?", [ticket.drawId]);
        if (!draw || draw.state !== 'OPEN') {
          throw new Error('Draw session is locked or drawing. Reservation denied.');
        }
      }

      // Perform reservation lock on all
      for (const id of ids) {
        await tx.run(
          "UPDATE lottery_ticket_pool SET status = 'RESERVED', reservedBy = ?, reservedUntil = ? WHERE id = ?",
          [email.toLowerCase(), reservedUntil, id]
        );
      }

      return { ticketIds: ids, reservedUntil };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/lottery/release', async (req, res) => {
  try {
    const { email, ticketId, ticketIds } = req.body;
    const ids = Array.isArray(ticketIds) ? ticketIds : (ticketId ? [ticketId] : []);
    if (!email || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing release parameters.' });
    }

    for (const id of ids) {
      await db.run(
        "UPDATE lottery_ticket_pool SET status = 'AVAILABLE', reservedBy = NULL, reservedUntil = NULL WHERE id = ? AND LOWER(reservedBy) = ?",
        [id, email.toLowerCase()]
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/lottery/checkout', checkKillSwitch, async (req, res) => {
  try {
    const { email, ticketId, ticketIds } = req.body;
    const ids = Array.isArray(ticketIds) ? ticketIds : (ticketId ? [ticketId] : []);
    if (!email || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing checkout parameters.' });
    }

    const nowIso = new Date().toISOString();

    const result = await db.executeTransaction(async (tx) => {
      let totalBetAmount = 0;
      const verifiedPoolTickets = [];
      let lotteryName = '';
      let drawId = null;

      // 1. Confirm all reservations match the user and haven't expired
      for (const id of ids) {
        const poolTicket = await tx.get(
          "SELECT * FROM lottery_ticket_pool WHERE id = ? AND LOWER(reservedBy) = ? AND status = 'RESERVED'",
          [id, email.toLowerCase()]
        );
        if (!poolTicket) {
          throw new Error(`No active reservation found for Ticket #${id}.`);
        }
        if (poolTicket.reservedUntil < nowIso) {
          throw new Error(`Reservation timeout! Ticket #${id} reservation has expired.`);
        }

        // 2. Fetch game config details
        const gameConfig = await tx.get('SELECT * FROM games_config WHERE name = ? AND status = ?', [poolTicket.lotteryName, 'ACTIVE']);
        if (!gameConfig) {
          throw new Error(`Active game configuration not found for ${poolTicket.lotteryName}.`);
        }

        totalBetAmount += gameConfig.ticket_price;
        verifiedPoolTickets.push(poolTicket);
        lotteryName = poolTicket.lotteryName;
        drawId = poolTicket.drawId;
      }

      // 3. Confirm draw is still open for wagers
      if (drawId) {
        const draw = await tx.get('SELECT * FROM lottery_draws WHERE id = ? AND state = ?', [drawId, 'OPEN']);
        if (!draw) {
          throw new Error('The draw session has locked or finished. Checkout failed.');
        }
      }

      // 4. Verify wallet balance
      const user = await tx.get('SELECT balance, gamesPlayed FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < totalBetAmount) throw new Error('Insufficient wallet funds to complete purchase.');

      // 5. Update user balance
      const newBalance = user.balance - totalBetAmount;
      const gamesPlayed = user.gamesPlayed + ids.length;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [newBalance, gamesPlayed, email.toLowerCase()]);

      // 6. Complete purchase for each ticket
      for (const poolTicket of verifiedPoolTickets) {
        await tx.run("UPDATE lottery_ticket_pool SET status = 'PURCHASED' WHERE id = ?", [poolTicket.id]);

        await tx.run(
          'INSERT INTO lottery_tickets (email, lotteryName, drawId, chosenNumbers, betAmount, claimed, payout, timestamp) VALUES (?, ?, ?, ?, ?, 0, 0.0, ?)',
          [email.toLowerCase(), poolTicket.lotteryName, poolTicket.drawId, poolTicket.chosenNumbers, totalBetAmount / ids.length, new Date().toISOString()]
        );
      }

      // 7. Add ledger transaction
      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [txId, email.toLowerCase(), 'LOTTERY_PLAY', -totalBetAmount, newBalance, new Date().toISOString()]
      );

      return { newBalance, drawId, lotteryName, totalBetAmount };
    });

    // Publish event for Gamification Engine
    await pubsub.publish({
      type: 'TICKET_PURCHASED',
      email: email.toLowerCase(),
      lotteryName: result.lotteryName,
      amount: result.totalBetAmount,
      timestamp: new Date().toISOString()
    });

    // Notify WebSockets clients to sync balances and tickets
    io.emit('lottery_events', { type: 'TICKET_PURCHASED' });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});


// --- REST Admin Endpoints ---

// 1. Emergency Kill-Switch Toggle
app.post('/api/admin/kill-switch', async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'State must be boolean active.' });
    }

    const valueStr = active ? 'true' : 'false';
    await db.run(
      "INSERT OR REPLACE INTO game_settings (key, value) VALUES ('kill_switch_active', ?)",
      [valueStr]
    );

    // Publish event across all instances
    await pubsub.publish({ type: 'KILL_SWITCH', active });
    
    console.log(`[LOTTERY ENGINE] Emergency Kill-Switch updated to: ${active}`);
    res.json({ success: true, killSwitchActive: active });
  } catch (error) {
    console.error('Kill-switch error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 2. RNG Audit Verification
app.get('/api/admin/audit-verify/:drawId', async (req, res) => {
  try {
    const { drawId } = req.params;
    const drawIdInt = parseInt(drawId, 10);
    if (isNaN(drawIdInt)) {
      return res.status(400).json({ success: false, error: 'Invalid draw ID.' });
    }

    const audit = await db.get('SELECT * FROM audit_rng_logs WHERE drawId = ?', [drawIdInt]);
    if (!audit) {
      return res.status(404).json({ success: false, error: 'RNG Audit trail not found for this draw ID.' });
    }

    const { verifyDrawNumbers } = require('@cyber-casino/shared/cryptoRng');
    const winningNumbers = JSON.parse(audit.winningNumbers);
    
    // Validate provably fair
    const isVerified = verifyDrawNumbers(audit.seed, audit.salt, winningNumbers);

    res.json({
      success: true,
      drawId: drawIdInt,
      verified: isVerified,
      seed: audit.seed,
      salt: audit.salt,
      hash: audit.hash,
      winningNumbers,
      timestamp: audit.timestamp
    });
  } catch (error) {
    console.error('Audit verification error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 3. Stats Summary (For Admin Panel UI info)
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    const totalWinnings = await db.get('SELECT SUM(amount) as sum FROM transactions WHERE type = "LOTTERY_WINOUT"');
    const activeKillSwitch = await db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");

    res.json({
      success: true,
      stats: {
        usersCount: totalUsers.count,
        totalPayouts: totalWinnings.sum || 0,
        killSwitchActive: activeKillSwitch ? activeKillSwitch.value === 'true' : false
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Create HTTP server to run Express + WebSockets on the same port
const http = require('http');
const socketIo = require('socket.io');

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Relayer for background pubsub drawing events to active WebSockets clients
pubsub.on('message', (message) => {
  if (message && message.type !== 'KILL_SWITCH') {
    console.log(`[LOTTERY ENGINE] Relaying event to WebSockets: ${message.type}`);
    io.emit('lottery_events', message);
    if (message.type === 'DICE_CONFIG_UPDATED') {
      io.emit('dice_events', { type: 'DICE_TOURNEY_CREATED' });
    }
  }
});
// WebSockets connection routing
const chatBotMessages = [
  "Just got a 10x multiplier on Spin Wheel! Let's go! 🎡",
  "Is anyone playing the Sugar Rush 15 draw? It's about to roll!",
  "Who is SuperAdmin? Saw them claim a VIP bonus earlier. 🔥",
  "Wild! Just hit 4 matching balls in Sweet Treat 30!",
  "Depositing some BTC, hoping to hit the Grand Ganache jackpot tonight. 🪙",
  "Good luck everyone! May the RNG be with you.",
  "Check out the leaderboard, the top player is absolutely crushing it today."
];
const chatBotNames = ["NeonSpins", "LuckyByte", "JackpotRunner", "CryptoCzar", "WildDealer", "VegasGrid"];

io.on('connection', (socket) => {
  console.log(`[LOTTERY ENGINE] Client connected to WebSockets: ${socket.id}`);
  
  socket.on('request_initial_state', async () => {
    try {
      const activeDraws = {};
      const games = await db.all("SELECT * FROM games_config WHERE status = 'ACTIVE'");
      
      for (const g of games) {
        let draw = await db.get('SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1', [g.name]);
        if (!draw) {
          await db.run('INSERT INTO lottery_draws (lotteryName, state, winningNumbers, timestamp) VALUES (?, "OPEN", NULL, ?)', [g.name, new Date().toISOString()]);
          draw = await db.get('SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1', [g.name]);
        }
        activeDraws[g.name] = draw;
      }
      
      const ksSetting = await db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
      
      socket.emit('initial_state', {
        draws: activeDraws,
        killSwitchActive: ksSetting ? ksSetting.value === 'true' : false
      });
    } catch (err) {
      console.error('[LOTTERY ENGINE WS ERROR]', err);
    }
  });

  // Chat message listener
  socket.on('send_chat_message', (data) => {
    if (!data || !data.message) return;
    
    // Broadcast user's message
    io.emit('chat_message', {
      username: data.username || 'Guest',
      email: data.email || 'guest@casino.com',
      message: data.message.substring(0, 200), // Limit length
      role: data.role || 'USER',
      timestamp: new Date().toISOString()
    });

    // Automated Agent Chatbot responder logic
    const msgLower = data.message.toLowerCase();
    let reply = '';

    if (msgLower.includes('deposit')) {
      reply = `@${data.username} To deposit funds, navigate to the "Wallet Dashboard" in the sidebar and choose Credit Card or Crypto via our secure CyberPay checkout.`;
    } else if (msgLower.includes('withdraw')) {
      reply = `@${data.username} Withdrawals are processed immediately to external routing accounts. Set your withdrawal amount under the "Wallet Dashboard".`;
    } else if (msgLower.includes('vip') || msgLower.includes('loyalty') || msgLower.includes('points') || msgLower.includes('silver') || msgLower.includes('gold')) {
      reply = `@${data.username} VIP levels are updated automatically based on your wagers! Reach Silver for a $50 cash bonus, or Gold for a $250 bonus. Track progress in your User Profile page.`;
    } else if (msgLower.includes('lottery') || msgLower.includes('ticket') || msgLower.includes('game') || msgLower.includes('play')) {
      reply = `@${data.username} We host multiple draw pools (from 15s to 900s). Pick your numbers in "Cyber Lottery" and wagers will update dynamically on draw completions!`;
    } else if (msgLower.includes('help') || msgLower.includes('support') || msgLower.includes('agent')) {
      reply = `@${data.username} Hello! I am Agent Neo, your automated support chatbot. How can I assist you with games, VIP status, or payments today?`;
    }

    if (reply) {
      setTimeout(() => {
        io.emit('chat_message', {
          username: 'Agent Neo',
          email: 'agent.neo@support.casino',
          message: reply,
          role: 'ADMIN',
          timestamp: new Date().toISOString()
        });
      }, 1500);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`[LOTTERY ENGINE] Client disconnected: ${socket.id}`);
  });
});

// Periodic simulated chat bot interactions to make the casino lobby feel alive
setInterval(() => {
  const randomName = chatBotNames[Math.floor(Math.random() * chatBotNames.length)];
  const randomMsg = chatBotMessages[Math.floor(Math.random() * chatBotMessages.length)];
  io.emit('chat_message', {
    username: randomName,
    email: `${randomName.toLowerCase()}@bot.casino`,
    message: randomMsg,
    role: 'USER',
    timestamp: new Date().toISOString()
  });
}, 45000);

// --- Dice Game Endpoints ---
app.get('/api/dice/config', async (req, res) => {
  try {
    const config = await db.all('SELECT * FROM dice_config');
    const configMap = {};
    config.forEach(c => configMap[c.key] = c.value);
    res.json({ success: true, config: configMap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/dice/roll-single', async (req, res) => {
  try {
    const { email, bet, prediction } = req.body;
    const betAmount = parseFloat(bet);
    if (!email || isNaN(betAmount) || betAmount <= 0 || !prediction) {
      return res.status(400).json({ success: false, error: 'Invalid dice bet details.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < betAmount) throw new Error('Insufficient wallet funds.');

      const die1 = crypto.randomInt(1, 7);
      const die2 = crypto.randomInt(1, 7);
      const sum = die1 + die2;
      const isDouble = die1 === die2;

      let balance = user.balance - betAmount;
      const gamesPlayed = user.gamesPlayed + 1;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [balance, gamesPlayed, email.toLowerCase()]);

      const multUnderRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_under_7'");
      const multExactRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_exact_7'");
      const multOverRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_over_7'");
      const multDoublesRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_doubles'");

      const multUnder = multUnderRow ? parseFloat(multUnderRow.value) : 2.3;
      const multExact = multExactRow ? parseFloat(multExactRow.value) : 5.8;
      const multOver = multOverRow ? parseFloat(multOverRow.value) : 2.3;
      const multDoubles = multDoublesRow ? parseFloat(multDoublesRow.value) : 5.8;

      let win = false;
      let multiplier = 0;
      if (prediction === 'UNDER_7' && sum < 7) {
        win = true;
        multiplier = multUnder;
      } else if (prediction === 'EXACT_7' && sum === 7) {
        win = true;
        multiplier = multExact;
      } else if (prediction === 'OVER_7' && sum > 7) {
        win = true;
        multiplier = multOver;
      } else if (prediction === 'DOUBLES' && isDouble) {
        win = true;
        multiplier = multDoubles;
      }

      let payout = win ? betAmount * multiplier : 0;
      let totalWon = user.totalWon;

      if (payout > 0) {
        balance += payout;
        totalWon += payout;
        await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [balance, totalWon, email.toLowerCase()]);

        const winTxId = generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [winTxId, email.toLowerCase(), 'DICE_WIN', payout, balance, new Date().toISOString()]
        );
      }

      const playTxId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [playTxId, email.toLowerCase(), 'DICE_PLAY', -betAmount, balance - payout, new Date().toISOString()]
      );

      // Route wager commission & trigger bounty check
      await routeWagerCommission(email, betAmount, 'DICE', tx);
      await checkAndTriggerBounty(email, tx);

      return {
        die1,
        die2,
        sum,
        payout,
        win,
        newBalance: balance
      };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

let globalCrashDaemon = null;

// --- Crash Game Endpoints ---
app.get('/api/crash/active-bets', async (req, res) => {
  try {
    const game = await db.get('SELECT id FROM crash_games ORDER BY id DESC LIMIT 1');
    if (!game) return res.json({ success: true, bets: [] });

    const bets = await db.all(`
      SELECT b.id, b.bet_amount, b.cashout_multiplier, b.winnings, b.status, u.username
      FROM crash_bets b
      JOIN users u ON LOWER(b.email) = LOWER(u.email)
      WHERE b.game_id = ?
    `, [game.id]);
    res.json({ success: true, bets: bets.map(b => ({
      id: b.id,
      username: b.username,
      betAmount: b.bet_amount,
      cashoutMultiplier: b.cashout_multiplier,
      winnings: b.winnings,
      status: b.status
    }))});
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.get('/api/crash/history', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    const history = await db.all(`
      SELECT b.id, b.bet_amount, b.cashout_multiplier, b.winnings, b.status, b.created_at, g.crash_point
      FROM crash_bets b
      JOIN crash_games g ON b.game_id = g.id
      WHERE LOWER(b.email) = ?
      ORDER BY b.id DESC LIMIT 50
    `, [email.toLowerCase()]);
    res.json({ success: true, history: history.map(b => ({
      id: b.id,
      betAmount: b.bet_amount,
      cashoutMultiplier: b.cashout_multiplier,
      winnings: b.winnings,
      status: b.status,
      createdAt: b.created_at,
      crashPoint: b.crash_point
    }))});
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/crash/bet', async (req, res) => {
  try {
    const { email, bet } = req.body;
    const betAmount = parseFloat(bet);
    if (!email || isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid bet details.' });
    }

    if (globalCrashDaemon) {
      if (betAmount < globalCrashDaemon.minBet) {
         return res.status(400).json({ success: false, error: `Minimum bet is $${globalCrashDaemon.minBet}.` });
      }
      if (betAmount > globalCrashDaemon.maxBet) {
         return res.status(400).json({ success: false, error: `Maximum bet is $${globalCrashDaemon.maxBet}.` });
      }
    }

    const result = await db.executeTransaction(async (tx) => {
      const user = await tx.get('SELECT balance, username FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < betAmount) throw new Error('Insufficient wallet funds.');

      const game = await tx.get('SELECT id FROM crash_games WHERE status = "BETTING" ORDER BY id DESC LIMIT 1');
      if (!game) throw new Error('No open lobby for betting right now.');

      const existingBets = await tx.get('SELECT COUNT(*) as count FROM crash_bets WHERE game_id = ? AND LOWER(email) = ?', [game.id, email.toLowerCase()]);
      if (existingBets.count >= 2) throw new Error('You can only place up to 2 bets per round.');

      const newBalance = user.balance - betAmount;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBalance, email.toLowerCase()]);

      const betInsert = await tx.run(
        'INSERT INTO crash_bets (game_id, email, bet_amount, status, created_at) VALUES (?, ?, ?, ?, ?)',
        [game.id, email.toLowerCase(), betAmount, 'LOCKED', new Date().toISOString()]
      );

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "CRASH_BET", ?, ?, ?)',
        [txId, email.toLowerCase(), -betAmount, newBalance, new Date().toISOString()]
      );

      if (globalCrashDaemon) {
        globalCrashDaemon.io.emit('crash_bet_placed', {
          id: betInsert.lastID,
          gameId: game.id,
          username: user.username,
          betAmount,
          cashoutMultiplier: null,
          winnings: null,
          status: 'LOCKED'
        });
      }

      // Route wager commission & trigger bounty check
      await routeWagerCommission(email, betAmount, 'CRASH', tx);
      await checkAndTriggerBounty(email, tx);

      return { newBalance, gameId: game.id, betId: betInsert.lastID };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/crash/cashout', async (req, res) => {
  try {
    const { email, betId } = req.body;
    if (!email || !betId) return res.status(400).json({ success: false, error: 'Email and betId required.' });

    if (!globalCrashDaemon || globalCrashDaemon.state !== 'FLIGHT') {
      return res.status(400).json({ success: false, error: 'Flight is not active or already crashed.' });
    }

    const currentMultiplier = globalCrashDaemon.currentMultiplier;
    const gameId = globalCrashDaemon.gameId;

    const result = await db.executeTransaction(async (tx) => {
      const bet = await tx.get('SELECT * FROM crash_bets WHERE id = ? AND game_id = ? AND LOWER(email) = ? AND status = "LOCKED"', [betId, gameId, email.toLowerCase()]);
      if (!bet) throw new Error('No locked bet found for this round.');

      const payout = bet.bet_amount * currentMultiplier;
      
      await tx.run('UPDATE crash_bets SET status = "WON", cashout_multiplier = ?, winnings = ? WHERE id = ?', [currentMultiplier, payout, bet.id]);
      
      const user = await tx.get('SELECT balance, totalWon, username FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      const newBalance = user.balance + payout;
      const newTotalWon = user.totalWon + payout;

      await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [newBalance, newTotalWon, email.toLowerCase()]);

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "CRASH_CASHOUT", ?, ?, ?)',
        [txId, email.toLowerCase(), payout, newBalance, new Date().toISOString()]
      );

      if (globalCrashDaemon) {
        globalCrashDaemon.io.emit('crash_cashed_out', {
          id: bet.id,
          gameId: gameId,
          username: user.username,
          betAmount: bet.bet_amount,
          cashoutMultiplier: currentMultiplier,
          winnings: payout,
          status: 'WON'
        });
      }

      return { newBalance, payout, multiplier: currentMultiplier };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/dice/tournaments', async (req, res) => {
  try {
    const tournaments = await db.all('SELECT * FROM dice_tournaments ORDER BY id DESC');
    res.json({ success: true, tournaments });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/dice/tournament/join', requireAuth, async (req, res) => {
  try {
    const { tournamentId } = req.body;
    const email = req.user.email;
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) {
      return res.status(400).json({ success: false, error: 'Invalid details.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const tourney = await tx.get('SELECT * FROM dice_tournaments WHERE id = ? AND status = "ACTIVE"', [tourneyIdInt]);
      if (!tourney) throw new Error('Active tournament not found.');

      if (tourney.ends_at && new Date(tourney.ends_at) < new Date()) {
        throw new Error('Tournament has already ended.');
      }

      const participant = await tx.get('SELECT * FROM dice_tournament_participants WHERE tournament_id = ? AND LOWER(email) = ?', [tourneyIdInt, email.toLowerCase()]);
      if (participant) return { alreadyJoined: true };

      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < tourney.entry_fee) throw new Error('Insufficient balance for entry fee.');

      const balance = user.balance - tourney.entry_fee;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [balance, email.toLowerCase()]);

      const newPrizePool = tourney.prize_pool + tourney.entry_fee;
      await tx.run('UPDATE dice_tournaments SET prize_pool = ? WHERE id = ?', [newPrizePool, tourneyIdInt]);

      await tx.run('INSERT INTO dice_tournament_participants (tournament_id, email, rolls_left, total_score, completed) VALUES (?, ?, 10, 0, 0)', [tourneyIdInt, email.toLowerCase()]);

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "DICE_TOURNEY_ENTRY", ?, ?, ?)',
        [txId, email.toLowerCase(), -tourney.entry_fee, balance, new Date().toISOString()]
      );

      return { success: true, newBalance: balance, alreadyJoined: false };
    });

    if (result.success || result.alreadyJoined) {
      io.emit('dice_events', { type: 'DICE_LEADERBOARD_UPDATED', tournamentId: tourneyIdInt, email });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/dice/tournament/roll', requireAuth, async (req, res) => {
  try {
    const { tournamentId } = req.body;
    const email = req.user.email;
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) {
      return res.status(400).json({ success: false, error: 'Invalid details.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const tourney = await tx.get('SELECT * FROM dice_tournaments WHERE id = ? AND status = "ACTIVE"', [tourneyIdInt]);
      if (!tourney) throw new Error('Tournament is no longer active.');

      if (tourney.ends_at && new Date(tourney.ends_at) < new Date()) {
        throw new Error('Tournament has already ended.');
      }

      const participant = await tx.get('SELECT * FROM dice_tournament_participants WHERE tournament_id = ? AND LOWER(email) = ?', [tourneyIdInt, email.toLowerCase()]);
      if (!participant) throw new Error('You are not registered in this tournament.');
      if (participant.rolls_left <= 0) throw new Error('No rolls remaining for this tournament.');

      const die1 = crypto.randomInt(1, 7);
      const die2 = crypto.randomInt(1, 7);
      const sum = die1 + die2;

      const newRollsLeft = participant.rolls_left - 1;
      const newScore = participant.total_score + sum;
      const isCompleted = newRollsLeft === 0 ? 1 : 0;

      await tx.run(
        'UPDATE dice_tournament_participants SET rolls_left = ?, total_score = ?, completed = ? WHERE tournament_id = ? AND LOWER(email) = ?',
        [newRollsLeft, newScore, isCompleted, tourneyIdInt, email.toLowerCase()]
      );

      return {
        die1,
        die2,
        sum,
        rollsLeft: newRollsLeft,
        totalScore: newScore,
        completed: isCompleted
      };
    });

    if (result.sum !== undefined) {
      io.emit('dice_events', { type: 'DICE_LEADERBOARD_UPDATED', tournamentId: tourneyIdInt, email });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/dice/tournament/buy-rolls', requireAuth, async (req, res) => {
  try {
    const { tournamentId } = req.body;
    const email = req.user.email;
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) {
      return res.status(400).json({ success: false, error: 'Invalid details.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const tourney = await tx.get('SELECT * FROM dice_tournaments WHERE id = ? AND status = "ACTIVE"', [tourneyIdInt]);
      if (!tourney) throw new Error('Tournament is no longer active.');

      if (tourney.ends_at && new Date(tourney.ends_at) < new Date()) {
        throw new Error('Tournament has already ended.');
      }

      const participant = await tx.get('SELECT * FROM dice_tournament_participants WHERE tournament_id = ? AND LOWER(email) = ?', [tourneyIdInt, email.toLowerCase()]);
      if (!participant) throw new Error('You are not registered in this tournament.');

      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < tourney.entry_fee) throw new Error('Insufficient balance to buy rolls.');

      const balance = user.balance - tourney.entry_fee;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [balance, email.toLowerCase()]);

      const newPrizePool = tourney.prize_pool + tourney.entry_fee;
      await tx.run('UPDATE dice_tournaments SET prize_pool = ? WHERE id = ?', [newPrizePool, tourneyIdInt]);

      const newRolls = participant.rolls_left + 10;
      await tx.run(
        'UPDATE dice_tournament_participants SET rolls_left = ?, completed = 0 WHERE tournament_id = ? AND LOWER(email) = ?',
        [newRolls, tourneyIdInt, email.toLowerCase()]
      );

      const txId = generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "DICE_TOURNEY_BUY_ROLLS", ?, ?, ?)',
        [txId, email.toLowerCase(), -tourney.entry_fee, balance, new Date().toISOString()]
      );

      return { success: true, newBalance: balance, rollsLeft: newRolls };
    });

    io.emit('dice_events', { type: 'DICE_LEADERBOARD_UPDATED', tournamentId: tourneyIdInt, email });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/dice/tournament/leaderboard/:tournamentId', async (req, res) => {
  try {
    const tourneyIdInt = parseInt(req.params.tournamentId, 10);
    if (isNaN(tourneyIdInt)) {
      return res.status(400).json({ success: false, error: 'Invalid tournament ID.' });
    }

    const leaderboard = await db.all(`
      SELECT p.email, p.total_score, p.rolls_left, p.completed, u.username
      FROM dice_tournament_participants p
      JOIN users u ON LOWER(p.email) = LOWER(u.email)
      WHERE p.tournament_id = ?
      ORDER BY p.total_score DESC, p.rolls_left ASC
    `, [tourneyIdInt]);

    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Reverse proxy /api/admin requests to the backoffice-api service (port 5001) for Cloud Run single-port routing
app.use('/api/admin', async (req, res) => {
  try {
    const targetUrl = `http://127.0.0.1:5001/api/admin${req.url}`;
    
    const options = {
      method: req.method,
      headers: { 
        'Content-Type': 'application/json',
        'host': '127.0.0.1:5001'
      }
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[LOTTERY ENGINE PROXY ERROR]', error);
    res.status(502).json({ success: false, error: 'Back-office API Gateway Timeout' });
  }
});

// Reverse proxy /api/loyalty requests to the loyalty-engine service (port 5002) for Cloud Run single-port routing
app.use('/api/loyalty', async (req, res) => {
  try {
    const targetUrl = `http://127.0.0.1:5002/api/loyalty${req.url}`;
    
    const options = {
      method: req.method,
      headers: { 
        'Content-Type': 'application/json',
        'host': '127.0.0.1:5002'
      }
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[LOTTERY ENGINE LOYALTY PROXY ERROR]', error);
    res.status(502).json({ success: false, error: 'Loyalty Engine Timeout' });
  }
});

// Serve frontend build in production
const distPath = path.join(__dirname, 'dist');
const distAdminPath = path.join(__dirname, 'dist-admin');

// Serve admin panel static assets under /admin
app.use('/admin', express.static(distAdminPath));
app.get('/admin/*', (req, res) => {
  const fs = require('fs');
  const indexHtmlPath = path.join(distAdminPath, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    res.sendFile(indexHtmlPath);
  } else {
    res.send('<h3>Cyber Casino Admin Portal not found.</h3><p>Run <code>npm run build:admin</code> to compile production assets.</p>');
  }
});

app.use(express.static(distPath));

app.get('*', (req, res) => {
  const fs = require('fs');
  const indexHtmlPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    res.sendFile(indexHtmlPath);
  } else {
    res.send('<h3>Cyber Casino API Gateway is active.</h3><p>Local development hot reload active on port 3000. Run <code>npm run build:frontend</code> to compile production assets.</p>');
  }
});

// Start Database & Listen
const startServer = async () => {
  await db.initDatabase();
  await pubsub.connect();
  
  // Read initial Kill-Switch state from settings
  const gs = await db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
  isKillSwitchActive = gs ? (gs.value === 'true') : false;

  if (process.env.RUN_WORKER_CONCURRENTLY === 'true') {
    const { fork } = require('child_process');
    const childProcesses = [];

    const spawnChild = (scriptPath, name, envOverrides = {}) => {
      console.log(`[LOTTERY ENGINE] Spawning concurrent ${name}...`);
      const child = fork(scriptPath, {
        env: { ...process.env, ...envOverrides }
      });

      child.on('message', (message) => {
        console.log(`[LOTTERY ENGINE] Received IPC event from ${name}:`, message.type || message);
        
        // Relayer fallback: emit in the parent's pubsub event loop
        pubsub.emit('message', message);

        // Broadcast to all OTHER child processes
        childProcesses.forEach(cp => {
          if (cp !== child && cp.connected) {
            cp.send(message);
          }
        });
      });

      child.on('error', (err) => {
        console.error(`[LOTTERY ENGINE] ${name} process encountered error:`, err);
      });

      child.on('exit', (code, signal) => {
        console.warn(`[LOTTERY ENGINE] ${name} process exited with code ${code} and signal ${signal}`);
      });

      childProcesses.push(child);
      return child;
    };

    spawnChild(path.join(__dirname, '..', 'payout-worker', 'worker.js'), 'payout-worker');
    spawnChild(path.join(__dirname, '..', 'backoffice-api', 'server.js'), 'backoffice-api', { PORT: '5001' });
    spawnChild(path.join(__dirname, '..', 'loyalty-engine', 'server.js'), 'loyalty-engine', { PORT: '5002' });
  }

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`>>>> [LOTTERY ENGINE] Unified REST + WebSockets server running on port ${PORT}`);
    
    // Boot up Crash Engine
    const CrashDaemon = require('./crashDaemon');
    globalCrashDaemon = new CrashDaemon(io);
    globalCrashDaemon.start();
  });
};

startServer().catch(err => {
  console.error('Engine startup failure:', err);
});
