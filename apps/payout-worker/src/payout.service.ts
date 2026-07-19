import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'crypto';
const { db, cryptoRng, pubsub } = require('@cyber-casino/shared');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const activeLocalWorkers: Record<string, { active: boolean; intervalId?: NodeJS.Timeout }> = {};

@Injectable()
export class PayoutService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.startScheduler();
  }

  onModuleDestroy() {
    Object.keys(activeLocalWorkers).forEach(gameName => {
      if (activeLocalWorkers[gameName].intervalId) {
        clearInterval(activeLocalWorkers[gameName].intervalId);
      }
    });
  }

  private async generateTicketPool(lotteryName: string, drawId: number) {
    console.log(`[SCHEDULER] ["${lotteryName}"] Pre-generating ticket pool for Draw ID ${drawId}...`);
    try {
      const totalTickets = 100;
      const pool: number[][] = [];
      
      const generateUniqueNumbers = () => {
        const nums = new Set<number>();
        while (nums.size < 6) {
          nums.add(Math.floor(Math.random() * 49) + 1);
        }
        return Array.from(nums).sort((a, b) => a - b);
      };

      for (let i = 0; i < totalTickets; i++) {
        pool.push(generateUniqueNumbers());
      }

      await db.executeTransaction(async (tx: any) => {
        for (const ticketNumbers of pool) {
          await tx.run(
            'INSERT INTO lottery_ticket_pool (lotteryName, drawId, chosenNumbers, status) VALUES (?, ?, ?, ?)',
            [lotteryName, drawId, JSON.stringify(ticketNumbers), 'AVAILABLE']
          );
        }
      });

      console.log(`[SCHEDULER] ["${lotteryName}"] Pre-generated ${totalTickets} tickets for Draw ID ${drawId}.`);
    } catch (err) {
      console.error(`[SCHEDULER] ["${lotteryName}"] Failed to generate ticket pool:`, err);
    }
  }

  private async executeLotteryDraw(lotteryName: string) {
    console.log(`\n[SCHEDULER] >>> Triggering draw for: "${lotteryName}"`);
    
    try {
      let activeDraw = await db.get(
        "SELECT * FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? ORDER BY id DESC LIMIT 1",
        [lotteryName]
      );

      if (!activeDraw) {
        const activeDrawResult = await db.run(
          'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
          [lotteryName, 'OPEN', new Date().toISOString()]
        );
        activeDraw = await db.get(
          "SELECT * FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? ORDER BY id DESC LIMIT 1",
          [lotteryName]
        );
        await this.generateTicketPool(lotteryName, activeDraw.id);
      }

      console.log(`[SCHEDULER] ["${lotteryName}"] Session active: Draw ID ${activeDraw.id}`);

      await db.run("UPDATE lottery_draws SET state = 'LOCKED' WHERE id = ?", [activeDraw.id]);
      console.log(`[SCHEDULER] ["${lotteryName}"] State updated to: LOCKED`);
      await pubsub.publish({
        type: 'DRAW_STATE_CHANGED',
        lotteryName,
        drawId: activeDraw.id,
        state: 'LOCKED'
      });

      await new Promise(r => setTimeout(r, 2000));

      await db.run("UPDATE lottery_draws SET state = 'DRAWING' WHERE id = ?", [activeDraw.id]);
      console.log(`[SCHEDULER] ["${lotteryName}"] State updated to: DRAWING`);
      await pubsub.publish({
        type: 'DRAW_STATE_CHANGED',
        lotteryName,
        drawId: activeDraw.id,
        state: 'DRAWING'
      });

      const serverSalt = crypto.randomBytes(16).toString('hex');
      const { winningNumbers, seed, hash } = cryptoRng.generateDrawNumbers(lotteryName, activeDraw.id, serverSalt);
      console.log(`[SCHEDULER] ["${lotteryName}"] Winning balls: [${winningNumbers.join(', ')}]`);

      await db.run(
        "UPDATE lottery_draws SET state = 'COMPLETED', winningNumbers = ? WHERE id = ?",
        [JSON.stringify(winningNumbers), activeDraw.id]
      );

      await db.run(
        "INSERT INTO audit_rng_logs (drawId, lotteryName, seed, salt, hash, winningNumbers, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [activeDraw.id, lotteryName, seed, serverSalt, hash, JSON.stringify(winningNumbers), new Date().toISOString()]
      );

      const tickets = await db.all("SELECT * FROM lottery_tickets WHERE drawId = ? AND claimed = 0", [activeDraw.id]);
      console.log(`[SCHEDULER] ["${lotteryName}"] Evaluating ${tickets.length} wagers...`);

      const gameConfig = await db.get("SELECT house_edge_percentage FROM games_config WHERE name = ?", [lotteryName]);
      const houseEdge = gameConfig ? gameConfig.house_edge_percentage : 0.30;

      let totalBetsCollected = 0;
      const winningTickets: any[] = [];

      for (const ticket of tickets) {
        totalBetsCollected += ticket.betAmount;
        const chosenNumbers = JSON.parse(ticket.chosenNumbers);
        const matched = chosenNumbers.filter((num: number) => winningNumbers.includes(num));
        if (matched.length >= 3) {
          winningTickets.push({ ...ticket, matchCount: matched.length });
        }
      }

      const prizePool = totalBetsCollected * (1 - houseEdge);
      let payoutPerWinner = 0;
      if (winningTickets.length > 0) {
        payoutPerWinner = prizePool / winningTickets.length;
      }

      let totalPayoutsCredited = 0;

      for (const ticket of tickets) {
        const isWinner = winningTickets.some(w => w.id === ticket.id);
        const payout = isWinner ? payoutPerWinner : 0;

        await db.run(
          "UPDATE lottery_tickets SET claimed = 1, payout = ? WHERE id = ?",
          [payout, ticket.id]
        );

        if (payout > 0) {
          const idempotencyKey = `payout:draw_${activeDraw.id}:ticket_${ticket.id}`;
          
          await db.executeTransaction(async (tx: any) => {
            const alreadyProcessed = await tx.get(
              "SELECT id FROM transactions WHERE id = ?",
              [idempotencyKey]
            );

            if (!alreadyProcessed) {
              const user = await tx.get("SELECT balance, totalWon FROM users WHERE email = ?", [ticket.email]);
              if (user) {
                const newBalance = user.balance + payout;
                const totalWon = user.totalWon + payout;
                
                await tx.run(
                  "UPDATE users SET balance = ?, totalWon = ? WHERE email = ?",
                  [newBalance, totalWon, ticket.email]
                );

                await tx.run(
                  "INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                  [idempotencyKey, ticket.email, 'LOTTERY_WINOUT', payout, newBalance, new Date().toISOString()]
                );

                totalPayoutsCredited += payout;
              }
            }
          });
        }
      }

      console.log(`[SCHEDULER] ["${lotteryName}"] Draw ID ${activeDraw.id} payout loop complete. Winnings: $${totalPayoutsCredited}`);

      await pubsub.publish({
        type: 'DRAW_COMPLETED',
        lotteryName,
        drawId: activeDraw.id,
        winningNumbers,
        totalPayout: totalPayoutsCredited,
        timestamp: new Date().toISOString()
      });

      const nextDrawRes = await db.run(
        'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
        [lotteryName, 'OPEN', new Date().toISOString()]
      );
      console.log(`[SCHEDULER] ["${lotteryName}"] Next draw session initialized.`);
      await this.generateTicketPool(lotteryName, nextDrawRes.lastID);

    } catch (error) {
      console.error(`[SCHEDULER] Error during drawing session of "${lotteryName}":`, error);
    }
  }

  private async startScheduler() {
    await db.initDatabase();
    await pubsub.connect(REDIS_URL);

    const syncDynamicWorkers = async () => {
      const gamesConfig = await db.all("SELECT * FROM games_config WHERE status = 'ACTIVE'");
      
      Object.keys(activeLocalWorkers).forEach(gameName => {
        if (activeLocalWorkers[gameName].intervalId) {
          clearInterval(activeLocalWorkers[gameName].intervalId);
        }
      });

      for (const game of gamesConfig) {
        const intervalTime = game.draw_interval_ms;
        
        let currentDraw = await db.get(
          "SELECT id FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? LIMIT 1",
          [game.name]
        );
        if (!currentDraw) {
          const insertRes = await db.run(
            'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
            [game.name, 'OPEN', new Date().toISOString()]
          );
          await this.generateTicketPool(game.name, insertRes.lastID);
        }

        console.log(`[SCHEDULER] Configuring NestJS interval loop for "${game.name}" (${intervalTime / 1000}s)`);
        
        activeLocalWorkers[game.name] = { active: false };
        
        const intervalId = setInterval(async () => {
          if (activeLocalWorkers[game.name].active) return;
          activeLocalWorkers[game.name].active = true;
          await this.executeLotteryDraw(game.name);
          activeLocalWorkers[game.name].active = false;
        }, intervalTime);

        activeLocalWorkers[game.name].intervalId = intervalId;
      }
    };

    await syncDynamicWorkers();

    pubsub.on('message', async (event: any) => {
      if (event.type === 'GAME_CONFIG_UPDATED') {
        console.log('[SCHEDULER] Game configuration update detected. Resyncing workers...');
        await syncDynamicWorkers();
      }
    });
  }
}
