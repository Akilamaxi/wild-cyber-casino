const crypto = require('crypto');
const { db } = require('@cyber-casino/shared');

class CrashDaemon {
  constructor(io) {
    this.io = io;
    this.state = 'BETTING'; // BETTING, FLIGHT, CRASHED
    this.gameId = null;
    this.crashPoint = 1.0;
    this.currentMultiplier = 1.0;
    this.startTime = 0;
    this.tickInterval = null;
  }

  async start() {
    this.state = 'BETTING';
    this.currentMultiplier = 1.0;
    
    // Provably fair generation
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    
    // RNG to calculate crash point (1% house edge instant crash)
    const rawRng = crypto.randomInt(0, 10000) / 10000;
    const calculatedPoint = Math.max(1.00, 0.99 / (1.00001 - rawRng));
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
        timeRemaining: 5000,
        hash: hash
      });

      console.log(`[CRASH DAEMON] Started Game ${this.gameId}. Waiting 5s for flight...`);
      setTimeout(() => this.startFlight().catch(e => console.error('[CRASH DAEMON] Flight Error:', e)), 5000);
    } catch (err) {
      console.error('[CRASH DAEMON] Start Error:', err);
      setTimeout(() => this.start().catch(e => console.error(e)), 5000);
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
