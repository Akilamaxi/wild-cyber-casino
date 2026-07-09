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
  server.listen(PORT, () => {
    console.log(`>>>> [BACKOFFICE GATEWAY] Socket.io WebSocket server running on port ${PORT}`);
  });
};

startServer().catch(err => {
  console.error('Backoffice gateway startup failure:', err);
});
