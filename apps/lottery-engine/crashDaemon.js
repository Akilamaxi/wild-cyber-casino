const crypto = require('crypto');
const { db, pubsub } = require('@cyber-casino/shared');

class CrashDaemon {
  constructor(io) {
    this.io = io;
    this.state = 'BETTING'; // BETTING, FLIGHT, CRASHED
    this.gameId = null;
    this.crashPoint = 1.0;
    this.currentMultiplier = 1.0;
    this.startTime = 0;
    this.tickInterval = null;
    this.lobbyTimeMs = 5000;
    this.houseEdge = 0.01;
    this.initPubSub();
  }

  async loadConfig() {
    try {
      // create table if not exists ensures startup safety if db migration slow
      await db.run('CREATE TABLE IF NOT EXISTS crash_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const configRows = await db.all('SELECT * FROM crash_config');
      if (configRows && configRows.length > 0) {
        const cfg = {};
        configRows.forEach(r => cfg[r.key] = r.value);
        if (cfg.lobby_time_ms) this.lobbyTimeMs = parseInt(cfg.lobby_time_ms, 10);
        if (cfg.house_edge) this.houseEdge = parseFloat(cfg.house_edge);
      }
    } catch (err) {
      console.error('[CRASH DAEMON] Error loading config, using defaults:', err);
    }
  }

  initPubSub() {
    pubsub.on('message', async (message) => {
      if (message.type === 'CRASH_CONFIG_UPDATED') {
        console.log('[CRASH DAEMON] CRASH_CONFIG_UPDATED received, reloading config...');
        await this.loadConfig();
      }
    });
  }

  async start() {
    await this.loadConfig();
    this.state = 'BETTING';
    this.currentMultiplier = 1.0;
    
    // Provably fair generation
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    
    // RNG to calculate crash point
    const rawRng = crypto.randomInt(0, 10000) / 10000;
    const safeEdge = 1.00 - this.houseEdge;
    const calculatedPoint = Math.max(1.00, safeEdge / (1.00001 - rawRng));
    this.crashPoint = Math.floor(calculatedPoint * 100) / 100;

    try {
      const res = await db.run(
        'INSERT INTO crash_games (status, crash_point, server_seed, created_at) VALUES (?, ?, ?, ?)',
        ['BETTING', this.crashPoint, serverSeed, new Date().toISOString()]
      );
        
      this.gameId = res.lastID;

      this.broadcastState({
        status: 'BETTING',
        gameId: this.gameId,
        timeRemaining: this.lobbyTimeMs,
        hash: hash
      });

      console.log(`[CRASH DAEMON] Started Game ${this.gameId}. Waiting ${this.lobbyTimeMs}ms for flight...`);
      setTimeout(() => this.startFlight().catch(e => console.error('[CRASH DAEMON] Flight Error:', e)), this.lobbyTimeMs);
    } catch (err) {
      console.error('[CRASH DAEMON] Start Error:', err);
      setTimeout(() => this.start().catch(e => console.error(e)), this.lobbyTimeMs);
    }
  }

  async startFlight() {
    this.state = 'FLIGHT';
    this.currentMultiplier = 1.0;
    this.startTime = Date.now();
    
    await db.run('UPDATE crash_games SET status = "FLIGHT" WHERE id = ?', [this.gameId]);

    this.broadcastState({
      status: 'FLIGHT',
      gameId: this.gameId,
      multiplier: 1.0
    });

    this.tickInterval = setInterval(() => this.flightTick(), 100);
  }

  async flightTick() {
    const elapsedMs = Date.now() - this.startTime;
    // Exponential curve: multiplier = 1.00006 ^ elapsedMs
    this.currentMultiplier = Math.pow(1.00006, elapsedMs);

    if (this.currentMultiplier >= this.crashPoint) {
      clearInterval(this.tickInterval);
      this.currentMultiplier = this.crashPoint;
      await this.crash();
    } else {
      this.io.emit('crash_tick', {
        multiplier: this.currentMultiplier,
        gameId: this.gameId
      });
    }
  }

  async crash() {
    this.state = 'CRASHED';
    
    await db.run('UPDATE crash_games SET status = "CRASHED" WHERE id = ?', [this.gameId]);
    await db.run('UPDATE crash_bets SET status = "LOST" WHERE game_id = ? AND status = "LOCKED"', [this.gameId]);

    const game = await db.get('SELECT server_seed FROM crash_games WHERE id = ?', [this.gameId]);

    this.broadcastState({
      status: 'CRASHED',
      gameId: this.gameId,
      multiplier: this.crashPoint,
      serverSeed: game.server_seed
    });

    // Reset loop
    setTimeout(() => this.start(), 3000);
  }

  broadcastState(payload) {
    this.io.emit('crash_state', payload);
  }
}

module.exports = CrashDaemon;
