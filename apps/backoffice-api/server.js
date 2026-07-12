const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { db, pubsub, cryptoRng } = require('@cyber-casino/shared');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Stream PubSub events to all connected WebSocket clients
pubsub.on('message', (message) => {
  console.log(`[BACKOFFICE] Relaying Pub/Sub message to WebSockets: ${message.type}`);
  io.emit('lottery_events', message);
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
    
    console.log(`[BACKOFFICE] Emergency Kill-Switch updated to: ${active}`);
    res.json({ success: true, killSwitchActive: active });
  } catch (error) {
    console.error('Kill-switch error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// --- Game Configuration CRUD ---
app.get('/api/admin/games', async (req, res) => {
  try {
    const games = await db.all('SELECT * FROM games_config');
    res.json({ success: true, games });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/admin/games', async (req, res) => {
  try {
    const { id, name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status } = req.body;
    
    await db.run(
      'INSERT INTO games_config (id, name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, draw_interval_ms, ticket_price, max_tickets_per_user || 100, house_edge_percentage || 0.30, status || 'ACTIVE']
    );
    
    await pubsub.publish({ type: 'GAME_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/games/:id', async (req, res) => {
  try {
    const { name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status } = req.body;
    
    // Get old name first to cascade the rename
    const oldGame = await db.get('SELECT name FROM games_config WHERE id = ?', [req.params.id]);

    await db.executeTransaction(async (tx) => {
      await tx.run(
        'UPDATE games_config SET name = ?, draw_interval_ms = ?, ticket_price = ?, max_tickets_per_user = ?, house_edge_percentage = ?, status = ? WHERE id = ?',
        [name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status, req.params.id]
      );
      
      if (oldGame && oldGame.name !== name) {
        // Cascade rename to draws, pools, and tickets to prevent orphaned sessions
        await tx.run('UPDATE lottery_draws SET lotteryName = ? WHERE lotteryName = ?', [name, oldGame.name]);
        await tx.run('UPDATE lottery_ticket_pool SET lotteryName = ? WHERE lotteryName = ?', [name, oldGame.name]);
        await tx.run('UPDATE lottery_tickets SET lotteryName = ? WHERE lotteryName = ?', [name, oldGame.name]);
      }
    });
    
    await pubsub.publish({ type: 'GAME_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Spin Wheel Configuration CRUD ---
app.get('/api/admin/spinwheel-prizes', async (req, res) => {
  try {
    const prizes = await db.all('SELECT * FROM spin_wheel_prizes ORDER BY display_order ASC, id ASC');
    res.json({ success: true, prizes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/admin/spinwheel-prizes', async (req, res) => {
  try {
    const { text, color, textColor, mult, isBonus } = req.body;
    // Get max display order
    const maxOrderRow = await db.get('SELECT MAX(display_order) as max_order FROM spin_wheel_prizes');
    const nextOrder = (maxOrderRow && maxOrderRow.max_order !== null) ? parseInt(maxOrderRow.max_order, 10) + 1 : 0;
    
    await db.run(
      'INSERT INTO spin_wheel_prizes (text, color, textColor, mult, isBonus, display_order) VALUES (?, ?, ?, ?, ?, ?)',
      [text, color || '#ffffff', textColor || '#000000', parseFloat(mult) || 0.0, isBonus ? 1 : 0, nextOrder]
    );
    await pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/spinwheel-prizes/:id', async (req, res) => {
  try {
    const { text, color, textColor, mult, isBonus } = req.body;
    await db.run(
      'UPDATE spin_wheel_prizes SET text = ?, color = ?, textColor = ?, mult = ?, isBonus = ? WHERE id = ?',
      [text, color, textColor, parseFloat(mult) || 0.0, isBonus ? 1 : 0, req.params.id]
    );
    await pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/spinwheel-prizes/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM spin_wheel_prizes WHERE id = ?', [req.params.id]);
    await pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/spinwheel-prizes/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, error: 'Invalid payload: orderedIds array required.' });
    }
    await db.executeTransaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.run('UPDATE spin_wheel_prizes SET display_order = ? WHERE id = ?', [i, orderedIds[i]]);
      }
    });
    await pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/slots/config', async (req, res) => {
  try {
    const config = await db.all('SELECT * FROM slots_config');
    const configMap = {};
    config.forEach(c => configMap[c.key] = c.value);
    res.json({ success: true, config: configMap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.put('/api/admin/slots/config', async (req, res) => {
  try {
    const { payout_strategy, target_rtp, symbols_config } = req.body;
    
    await db.executeTransaction(async (tx) => {
      if (payout_strategy) {
        await tx.run('INSERT OR REPLACE INTO slots_config (key, value) VALUES ("payout_strategy", ?)', [payout_strategy]);
      }
      if (target_rtp !== undefined) {
        await tx.run('INSERT OR REPLACE INTO slots_config (key, value) VALUES ("target_rtp", ?)', [target_rtp.toString()]);
      }
      if (symbols_config) {
        // Validate JSON
        JSON.parse(symbols_config);
        await tx.run('INSERT OR REPLACE INTO slots_config (key, value) VALUES ("symbols_config", ?)', [symbols_config]);
      }
    });

    await pubsub.publish({ type: 'SLOTS_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Dice Admin Endpoints ---
app.get('/api/admin/dice/config', async (req, res) => {
  try {
    const config = await db.all('SELECT * FROM dice_config');
    const configMap = {};
    config.forEach(c => configMap[c.key] = c.value);
    res.json({ success: true, config: configMap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.put('/api/admin/dice/config', async (req, res) => {
  try {
    const { mult_under_7, mult_exact_7, mult_over_7, mult_doubles } = req.body;
    await db.executeTransaction(async (tx) => {
      if (mult_under_7 !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_under_7", ?)', [mult_under_7.toString()]);
      if (mult_exact_7 !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_exact_7", ?)', [mult_exact_7.toString()]);
      if (mult_over_7 !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_over_7", ?)', [mult_over_7.toString()]);
      if (mult_doubles !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_doubles", ?)', [mult_doubles.toString()]);
    });
    await pubsub.publish({ type: 'DICE_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/dice/tournaments', async (req, res) => {
  try {
    const { name, entry_fee, prize_pool, ends_at } = req.body;
    const fee = parseFloat(entry_fee);
    const pool = parseFloat(prize_pool);
    if (!name || isNaN(fee) || isNaN(pool) || fee < 0 || pool < 0) {
      return res.status(400).json({ success: false, error: 'Invalid tournament details.' });
    }

    const finalEndsAt = ends_at || new Date(Date.now() + 86400000).toISOString();

    await db.run(
      'INSERT INTO dice_tournaments (name, entry_fee, prize_pool, status, created_at, ends_at) VALUES (?, ?, ?, "ACTIVE", ?, ?)',
      [name, fee, pool, new Date().toISOString(), finalEndsAt]
    );
    await pubsub.publish({ type: 'DICE_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/dice/tournaments/:id/complete', async (req, res) => {
  try {
    const tourneyId = parseInt(req.params.id, 10);
    if (isNaN(tourneyId)) {
      return res.status(400).json({ success: false, error: 'Invalid tournament ID.' });
    }

    const result = await db.executeTransaction(async (tx) => {
      const tourney = await tx.get('SELECT * FROM dice_tournaments WHERE id = ? AND status = "ACTIVE"', [tourneyId]);
      if (!tourney) throw new Error('Active tournament not found.');

      // Fetch leaderboard sorted by score DESC, rolls left ASC
      const leaderboard = await tx.all(`
        SELECT email, total_score
        FROM dice_tournament_participants
        WHERE tournament_id = ?
        ORDER BY total_score DESC, rolls_left ASC
      `, [tourneyId]);

      const payoutsLog = [];

      if (leaderboard.length > 0) {
        const pool = tourney.prize_pool;
        let distributions = [];
        if (leaderboard.length === 1) {
          distributions = [1.0];
        } else if (leaderboard.length === 2) {
          distributions = [0.70, 0.30];
        } else {
          distributions = [0.60, 0.30, 0.10];
        }

        for (let i = 0; i < Math.min(leaderboard.length, distributions.length); i++) {
          const share = distributions[i];
          const amount = pool * share;
          const participant = leaderboard[i];

          const user = await tx.get('SELECT balance, totalWon FROM users WHERE LOWER(email) = ?', [participant.email.toLowerCase()]);
          if (user) {
            const newBalance = user.balance + amount;
            const newTotalWon = user.totalWon + amount;
            await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [newBalance, newTotalWon, participant.email.toLowerCase()]);

            const winTxId = 'DICE-T-WIN-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            await tx.run(
              'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "DICE_TOURNEY_PRIZE", ?, ?, ?)',
              [winTxId, participant.email.toLowerCase(), amount, newBalance, new Date().toISOString()]
            );

            payoutsLog.push({ email: participant.email, amount, rank: i + 1 });
          }
        }
      }

      await tx.run('UPDATE dice_tournaments SET status = "COMPLETED" WHERE id = ?', [tourneyId]);
      return { payouts: payoutsLog };
    });

    await pubsub.publish({ type: 'DICE_CONFIG_UPDATED' });
    res.json({ success: true, payouts: result.payouts });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Crash Admin Endpoints ---
app.get('/api/admin/crash/config', async (req, res) => {
  try {
    const config = await db.all('SELECT * FROM crash_config');
    const configMap = {};
    config.forEach(c => configMap[c.key] = c.value);
    res.json({ success: true, config: configMap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.put('/api/admin/crash/config', async (req, res) => {
  try {
    const { lobby_time_ms, house_edge, min_bet, max_bet, max_multiplier, crash_delay_ms } = req.body;
    await db.executeTransaction(async (tx) => {
      if (lobby_time_ms !== undefined) await tx.run('INSERT OR REPLACE INTO crash_config (key, value) VALUES ("lobby_time_ms", ?)', [lobby_time_ms.toString()]);
      if (house_edge !== undefined) await tx.run('INSERT OR REPLACE INTO crash_config (key, value) VALUES ("house_edge", ?)', [house_edge.toString()]);
      if (min_bet !== undefined) await tx.run('INSERT OR REPLACE INTO crash_config (key, value) VALUES ("min_bet", ?)', [min_bet.toString()]);
      if (max_bet !== undefined) await tx.run('INSERT OR REPLACE INTO crash_config (key, value) VALUES ("max_bet", ?)', [max_bet.toString()]);
      if (max_multiplier !== undefined) await tx.run('INSERT OR REPLACE INTO crash_config (key, value) VALUES ("max_multiplier", ?)', [max_multiplier.toString()]);
      if (crash_delay_ms !== undefined) await tx.run('INSERT OR REPLACE INTO crash_config (key, value) VALUES ("crash_delay_ms", ?)', [crash_delay_ms.toString()]);
    });
    await pubsub.publish({ type: 'CRASH_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Plinko Admin Endpoints ---
app.get('/api/admin/plinko/config', async (req, res) => {
  try {
    const config = await db.all('SELECT * FROM plinko_config');
    const configMap = {};
    config.forEach(c => configMap[c.key] = c.value);
    res.json({ success: true, config: configMap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.put('/api/admin/plinko/config', async (req, res) => {
  try {
    const { house_edge, min_bet, max_bet, rtp_bias, throw_out_chance } = req.body;
    await db.executeTransaction(async (tx) => {
      if (house_edge !== undefined) await tx.run('INSERT OR REPLACE INTO plinko_config (key, value) VALUES ("house_edge", ?)', [house_edge.toString()]);
      if (min_bet !== undefined) await tx.run('INSERT OR REPLACE INTO plinko_config (key, value) VALUES ("min_bet", ?)', [min_bet.toString()]);
      if (max_bet !== undefined) await tx.run('INSERT OR REPLACE INTO plinko_config (key, value) VALUES ("max_bet", ?)', [max_bet.toString()]);
      if (rtp_bias !== undefined) await tx.run('INSERT OR REPLACE INTO plinko_config (key, value) VALUES ("rtp_bias", ?)', [rtp_bias.toString()]);
      if (throw_out_chance !== undefined) await tx.run('INSERT OR REPLACE INTO plinko_config (key, value) VALUES ("throw_out_chance", ?)', [throw_out_chance.toString()]);
    });
    await pubsub.publish({ type: 'PLINKO_CONFIG_UPDATED' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- Affiliate Admin Endpoints ---
app.get('/api/admin/affiliate/config', async (req, res) => {
  try {
    const config = await db.all('SELECT * FROM affiliate_config');
    const configMap = {};
    config.forEach(c => configMap[c.key] = c.value);
    res.json({ success: true, config: configMap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.put('/api/admin/affiliate/config', async (req, res) => {
  try {
    const { 
      wager_commission_enabled, 
      bounty_referrer_amount, 
      bounty_referee_free_drops, 
      min_deposit_threshold, 
      min_wager_threshold 
    } = req.body;

    await db.executeTransaction(async (tx) => {
      if (wager_commission_enabled !== undefined) await tx.run('INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ("wager_commission_enabled", ?)', [wager_commission_enabled.toString()]);
      if (bounty_referrer_amount !== undefined) await tx.run('INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ("bounty_referrer_amount", ?)', [bounty_referrer_amount.toString()]);
      if (bounty_referee_free_drops !== undefined) await tx.run('INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ("bounty_referee_free_drops", ?)', [bounty_referee_free_drops.toString()]);
      if (min_deposit_threshold !== undefined) await tx.run('INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ("min_deposit_threshold", ?)', [min_deposit_threshold.toString()]);
      if (min_wager_threshold !== undefined) await tx.run('INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ("min_wager_threshold", ?)', [min_wager_threshold.toString()]);
    });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/affiliate/shadow-logs', async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM shadow_commission_logs ORDER BY timestamp DESC LIMIT 100');
    res.json({ success: true, logs });
  } catch (error) {
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

    const winningNumbers = JSON.parse(audit.winningNumbers);
    
    // Provably Fair check
    const isVerified = cryptoRng.verifyDrawNumbers(audit.seed, audit.salt, winningNumbers);

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

// --- Security & Risk Management endpoints ---

// Get active alerts
app.get('/api/admin/security/alerts', async (req, res) => {
  try {
    const alerts = await db.all('SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Resolve security alert
app.post('/api/admin/security/alerts/:id/resolve', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id, 10);
    const { adminEmail } = req.body;
    await db.run('UPDATE security_alerts SET resolved = 1 WHERE id = ?', [alertId]);
    
    // Log audit trail
    await db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, details, created_at) VALUES (?, "RESOLVE_ALERT", ?, ?)',
      [adminEmail || 'admin@test.com', `Resolved security alert ID: ${alertId}`, new Date().toISOString()]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Freeze / Unfreeze user account
app.post('/api/admin/users/:email/status', async (req, res) => {
  try {
    const { status, adminEmail } = req.body;
    const { email } = req.params;
    if (!['ACTIVE', 'FROZEN', 'BANNED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value.' });
    }

    await db.run('UPDATE users SET status = ? WHERE LOWER(email) = ?', [status, email.toLowerCase()]);

    if (status === 'FROZEN' || status === 'BANNED') {
      // Invalidate all active sessions across cluster
      if (pubsub.isRedisConnected && pubsub.redisPublisher) {
        await pubsub.redisPublisher.set(`blacklist:${email.toLowerCase()}`, 'true', 'EX', 86400);
      }
    } else {
      // Remove from blacklist
      if (pubsub.isRedisConnected && pubsub.redisPublisher) {
        await pubsub.redisPublisher.del(`blacklist:${email.toLowerCase()}`);
      }
    }

    // Log audit trail
    await db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, target_email, details, created_at) VALUES (?, "UPDATE_USER_STATUS", ?, ?, ?)',
      [adminEmail || 'admin@test.com', email.toLowerCase(), `Updated status to: ${status}`, new Date().toISOString()]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Custom user tags
app.get('/api/admin/users/:email/tags', async (req, res) => {
  try {
    const { email } = req.params;
    const tags = await db.all('SELECT tag FROM user_tags WHERE LOWER(email) = ?', [email.toLowerCase()]);
    res.json({ success: true, tags: tags.map(t => t.tag) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/admin/users/:email/tags', async (req, res) => {
  try {
    const { email } = req.params;
    const { tags, adminEmail } = req.body; // Array of tags
    if (!Array.isArray(tags)) {
      return res.status(400).json({ success: false, error: 'Tags must be an array.' });
    }

    await db.run('DELETE FROM user_tags WHERE LOWER(email) = ?', [email.toLowerCase()]);
    for (const tag of tags) {
      await db.run('INSERT INTO user_tags (email, tag) VALUES (?, ?)', [email.toLowerCase(), tag]);
    }

    // Log audit trail
    await db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, target_email, details, created_at) VALUES (?, "UPDATE_USER_TAGS", ?, ?, ?)',
      [adminEmail || 'admin@test.com', email.toLowerCase(), `Updated tags to: ${tags.join(', ')}`, new Date().toISOString()]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Rules Builder
app.get('/api/admin/bonus-rules', async (req, res) => {
  try {
    const rules = await db.all('SELECT * FROM bonus_rules ORDER BY id DESC');
    res.json({ success: true, rules });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/admin/bonus-rules', async (req, res) => {
  try {
    const { ruleName, triggerType, threshold, rewardType, rewardAmount, adminEmail } = req.body;
    const thresh = parseFloat(threshold);
    const amt = parseFloat(rewardAmount);
    if (!ruleName || !triggerType || isNaN(thresh) || !rewardType || isNaN(amt)) {
      return res.status(400).json({ success: false, error: 'Invalid trigger details.' });
    }

    const reward = JSON.stringify({ type: rewardType, amount: amt });

    await db.run(
      'INSERT INTO bonus_rules (rule_name, trigger_type, threshold, bonus_reward, active) VALUES (?, ?, ?, ?, 1)',
      [ruleName, triggerType, thresh, reward]
    );

    // Log audit trail
    await db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, details, created_at) VALUES (?, "CREATE_BONUS_RULE", ?, ?)',
      [adminEmail || 'admin@test.com', `Created bonus rule: ${ruleName} (Threshold: ${thresh}, Reward: ${rewardType} ${amt})`, new Date().toISOString()]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/admin/bonus-rules/:id/toggle', async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id, 10);
    const { active, adminEmail } = req.body;
    await db.run('UPDATE bonus_rules SET active = ? WHERE id = ?', [active ? 1 : 0, ruleId]);

    // Log audit trail
    await db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, details, created_at) VALUES (?, "TOGGLE_BONUS_RULE", ?, ?)',
      [adminEmail || 'admin@test.com', `Toggled rule ID: ${ruleId} to active=${active}`, new Date().toISOString()]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 360-Degree Player view
app.get('/api/admin/users/:email/360-view', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await db.get('SELECT email, username, balance, gamesPlayed, totalWon, role, status, wallet_address FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const tags = await db.all('SELECT tag FROM user_tags WHERE LOWER(email) = ?', [email.toLowerCase()]);
    const sessions = await db.all('SELECT ip_address, user_agent, country, city, created_at FROM user_session_logs WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 10', [email.toLowerCase()]);
    const transactions = await db.all('SELECT id, type, amount, balanceAfter, timestamp FROM transactions WHERE LOWER(email) = ? ORDER BY timestamp DESC LIMIT 20', [email.toLowerCase()]);
    const alerts = await db.all('SELECT id, alert_type, severity, details, resolved, created_at FROM security_alerts WHERE LOWER(email) = ? ORDER BY created_at DESC', [email.toLowerCase()]);

    res.json({
      success: true,
      user: {
        ...user,
        tags: tags.map(t => t.tag),
        sessions,
        transactions,
        alerts
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Raw game logs (all game types)
app.get('/api/admin/game-logs', async (req, res) => {
  try {
    const plinko = await db.all(
      'SELECT id, email, risk, destination_bin, payout, multiplier, wager_amount, rows, server_seed, client_seed, nonce, timestamp FROM plinko_drops ORDER BY id DESC LIMIT 50'
    );
    const dice = await db.all('SELECT id, name, status, entry_fee, created_at, ends_at FROM dice_tournaments ORDER BY id DESC LIMIT 50');
    const crash = await db.all('SELECT id, crash_point, status, created_at FROM crash_games ORDER BY id DESC LIMIT 50');
    const slots = await db.all(
      "SELECT id, email, type, amount, balanceAfter as balance_after, timestamp FROM transactions WHERE type IN ('SLOTS_PLAY','SLOTS_WINOUT') ORDER BY timestamp DESC LIMIT 50"
    );
    res.json({ success: true, plinko, dice, crash, slots });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Affiliate performance stats
app.get('/api/admin/affiliate/stats', async (req, res) => {
  try {
    const totalReferrals = await db.get('SELECT COUNT(*) as count FROM referrals');
    const completedReferrals = await db.get("SELECT COUNT(*) as count FROM referrals WHERE status = 'COMPLETED'");
    const totalCommissions = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'REFERRAL_COMMISSION'");
    const shadowTotal = await db.get('SELECT COALESCE(SUM(potential_commission), 0) as total FROM shadow_commission_logs');
    res.json({
      success: true,
      stats: {
        totalReferrals: totalReferrals?.count || 0,
        completedReferrals: completedReferrals?.count || 0,
        conversionRate: totalReferrals?.count > 0 ? ((completedReferrals?.count / totalReferrals?.count) * 100).toFixed(1) : '0.0',
        totalCommissionsPaid: parseFloat(totalCommissions?.total || 0).toFixed(2),
        shadowLoggedCommissions: parseFloat(shadowTotal?.total || 0).toFixed(4)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});


// Admin Audit Trail logs
app.get('/api/admin/audit-logs', async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM admin_audit_trail ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// WebSockets Event Listeners
io.on('connection', (socket) => {
  console.log(`[BACKOFFICE] WebSocket client connected: ${socket.id}`);
  
  // Send current status on join
  socket.on('request_initial_state', async () => {
    try {
      const activeDraw = await db.get('SELECT id, state, timestamp FROM lottery_draws ORDER BY id DESC LIMIT 1');
      const ksSetting = await db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
      
      socket.emit('initial_state', {
        draw: activeDraw,
        killSwitchActive: ksSetting ? ksSetting.value === 'true' : false
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[BACKOFFICE] WebSocket client disconnected: ${socket.id}`);
  });
});

// Start Server on Port 5001
const startServer = async () => {
  await db.initDatabase();
  await pubsub.connect();

  const PORT = process.env.PORT || 5001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`>>>> [BACKOFFICE GATEWAY] Socket.io WebSocket server running on port ${PORT}`);
  });
};

startServer().catch(err => {
  console.error('Backoffice gateway startup failure:', err);
});
