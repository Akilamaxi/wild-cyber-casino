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
