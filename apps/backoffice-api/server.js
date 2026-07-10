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
    const prizes = await db.all('SELECT * FROM spin_wheel_prizes ORDER BY id ASC');
    res.json({ success: true, prizes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/admin/spinwheel-prizes', async (req, res) => {
  try {
    const { text, color, textColor, mult, isBonus } = req.body;
    await db.run(
      'INSERT INTO spin_wheel_prizes (text, color, textColor, mult, isBonus) VALUES (?, ?, ?, ?, ?)',
      [text, color || '#ffffff', textColor || '#000000', parseFloat(mult) || 0.0, isBonus ? 1 : 0]
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

// --- Slots Configuration CRUD ---
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
    const { name, entry_fee, prize_pool } = req.body;
    const fee = parseFloat(entry_fee);
    const pool = parseFloat(prize_pool);
    if (!name || isNaN(fee) || isNaN(pool) || fee < 0 || pool < 0) {
      return res.status(400).json({ success: false, error: 'Invalid tournament details.' });
    }

    await db.run(
      'INSERT INTO dice_tournaments (name, entry_fee, prize_pool, status, created_at) VALUES (?, ?, ?, "ACTIVE", ?)',
      [name, fee, pool, new Date().toISOString()]
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
