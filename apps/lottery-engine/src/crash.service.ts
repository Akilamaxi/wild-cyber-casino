import { Injectable, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import * as crypto from 'crypto';
import { DbService, PubSubService } from '@cyber-casino/shared';

@Injectable()
export class CrashService implements OnModuleInit {
  private io: Server;
  public state: 'BETTING' | 'FLIGHT' | 'CRASHED' = 'BETTING';
  public gameId: number | null = null;
  public crashPoint = 1.0;
  public currentMultiplier = 1.0;
  private startTime = 0;
  private tickInterval: NodeJS.Timeout | null = null;
  
  // Configurations
  private lobbyTimeMs = 5000;
  private houseEdge = 0.01;
  private minBet = 1;
  private maxBet = 1000;
  private maxMultiplier = 10000;
  private crashDelayMs = 3000;

  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService
  ) {}

  onModuleInit() {
    this.pubsub.on('message', async (message: any) => {
      if (message.type === 'CRASH_CONFIG_UPDATED') {
        console.log('[CRASH DAEMON] CRASH_CONFIG_UPDATED received, reloading config...');
        await this.loadConfig();
      }
    });
  }

  setServer(io: Server) {
    this.io = io;
  }

  async loadConfig() {
    try {
      await this.db.run('CREATE TABLE IF NOT EXISTS crash_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const configRows = await this.db.all('SELECT * FROM crash_config');
      if (configRows && configRows.length > 0) {
        const cfg: Record<string, string> = {};
        configRows.forEach((r: any) => cfg[r.key] = r.value);
        if (cfg.lobby_time_ms) this.lobbyTimeMs = parseInt(cfg.lobby_time_ms, 10);
        if (cfg.house_edge) this.houseEdge = parseFloat(cfg.house_edge);
        if (cfg.min_bet) this.minBet = parseFloat(cfg.min_bet);
        if (cfg.max_bet) this.maxBet = parseFloat(cfg.max_bet);
        if (cfg.max_multiplier) this.maxMultiplier = parseFloat(cfg.max_multiplier);
        if (cfg.crash_delay_ms) this.crashDelayMs = parseInt(cfg.crash_delay_ms, 10);
      }
    } catch (err) {
      console.error('[CRASH DAEMON] Error loading config, using defaults:', err);
    }
  }

  async start() {
    await this.loadConfig();
    this.state = 'BETTING';
    this.currentMultiplier = 1.0;
    
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    
    const rawRng = crypto.randomInt(0, 10000) / 10000;
    const safeEdge = 1.00 - this.houseEdge;
    let calculatedPoint = Math.max(1.00, safeEdge / (1.00001 - rawRng));
    calculatedPoint = Math.min(calculatedPoint, this.maxMultiplier);
    this.crashPoint = Math.floor(calculatedPoint * 100) / 100;

    try {
      const res = await this.db.run(
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
    
    await this.db.run('UPDATE crash_games SET status = "FLIGHT" WHERE id = ?', [this.gameId]);

    this.broadcastState({
      status: 'FLIGHT',
      gameId: this.gameId,
      multiplier: 1.0
    });

    this.tickInterval = setInterval(() => this.flightTick(), 100);
  }

  async flightTick() {
    const elapsedMs = Date.now() - this.startTime;
    this.currentMultiplier = Math.pow(1.00006, elapsedMs);

    if (this.currentMultiplier >= this.crashPoint) {
      if (this.tickInterval) clearInterval(this.tickInterval);
      this.currentMultiplier = this.crashPoint;
      await this.crash();
    } else {
      if (this.io) {
        this.io.emit('crash_tick', {
          multiplier: this.currentMultiplier,
          gameId: this.gameId
        });
      }
    }
  }

  async crash() {
    this.state = 'CRASHED';
    
    await this.db.run('UPDATE crash_games SET status = "CRASHED" WHERE id = ?', [this.gameId]);
    await this.db.run('UPDATE crash_bets SET status = "LOST" WHERE game_id = ? AND status = "LOCKED"', [this.gameId]);

    const game = await this.db.get('SELECT server_seed FROM crash_games WHERE id = ?', [this.gameId]);

    this.broadcastState({
      status: 'CRASHED',
      gameId: this.gameId,
      multiplier: this.crashPoint,
      serverSeed: game ? game.server_seed : ''
    });

    setTimeout(() => this.start(), this.crashDelayMs);
  }

  broadcastState(payload: any) {
    if (this.io) {
      this.io.emit('crash_state', payload);
    }
  }
}
