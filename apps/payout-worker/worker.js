const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');
const { db, cryptoRng, pubsub } = require('@cyber-casino/shared');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const IS_PROD = process.env.NODE_ENV === 'production';

// Dynamic configurations are loaded from the database

// Track local active in-memory schedules
const activeLocalWorkers = {};

/**
 * Core Lottery Drawing Execution Logic for a specific game
 */
const executeLotteryDraw = async (lotteryName) => {
  console.log(`\n[SCHEDULER] >>> Triggering draw for: "${lotteryName}"`);
  
  try {
    // 1. Get current active open draw
    let activeDraw = await db.get(
      "SELECT * FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? ORDER BY id DESC LIMIT 1",
      [lotteryName]
    );

    if (!activeDraw) {
      await db.run(
        'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
        [lotteryName, 'OPEN', new Date().toISOString()]
      );
      activeDraw = await db.get(
        "SELECT * FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? ORDER BY id DESC LIMIT 1",
        [lotteryName]
      );
    }

    console.log(`[SCHEDULER] ["${lotteryName}"] Session active: Draw ID ${activeDraw.id}`);

    // 2. Lock ticket wagers
    await db.run("UPDATE lottery_draws SET state = 'LOCKED' WHERE id = ?", [activeDraw.id]);
    console.log(`[SCHEDULER] ["${lotteryName}"] State updated to: LOCKED`);
    await pubsub.publish({
      type: 'DRAW_STATE_CHANGED',
      lotteryName,
      drawId: activeDraw.id,
      state: 'LOCKED'
    });

    // Wait 2 seconds before drawing to let API wagers settle
    await new Promise(r => setTimeout(r, 2000));

    // 3. Set state to DRAWING
    await db.run("UPDATE lottery_draws SET state = 'DRAWING' WHERE id = ?", [activeDraw.id]);
    console.log(`[SCHEDULER] ["${lotteryName}"] State updated to: DRAWING`);
    await pubsub.publish({
      type: 'DRAW_STATE_CHANGED',
      lotteryName,
      drawId: activeDraw.id,
      state: 'DRAWING'
    });

    // 4. Generate winning numbers (HMAC SHA-256)
    const serverSalt = crypto.randomBytes(16).toString('hex');
    const { winningNumbers, seed, hash } = cryptoRng.generateDrawNumbers(lotteryName, activeDraw.id, serverSalt);
    console.log(`[SCHEDULER] ["${lotteryName}"] Winning balls: [${winningNumbers.join(', ')}]`);

    // 5. Save completed results
    await db.run(
      "UPDATE lottery_draws SET state = 'COMPLETED', winningNumbers = ? WHERE id = ?",
      [JSON.stringify(winningNumbers), activeDraw.id]
    );

    // Save RNG audit trail
    await db.run(
      "INSERT INTO audit_rng_logs (drawId, lotteryName, seed, salt, hash, winningNumbers, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [activeDraw.id, lotteryName, seed, serverSalt, hash, JSON.stringify(winningNumbers), new Date().toISOString()]
    );

    // 6. Process Dynamic Payouts
    const tickets = await db.all("SELECT * FROM lottery_tickets WHERE drawId = ? AND claimed = 0", [activeDraw.id]);
    console.log(`[SCHEDULER] ["${lotteryName}"] Evaluating ${tickets.length} wagers...`);

    const gameConfig = await db.get("SELECT house_edge_percentage FROM games_config WHERE name = ?", [lotteryName]);
    const houseEdge = gameConfig ? gameConfig.house_edge_percentage : 0.30;

    let totalBetsCollected = 0;
    const winningTickets = [];

    // Calculate total pool and isolate winners
    for (const ticket of tickets) {
      totalBetsCollected += ticket.betAmount;
      const chosenNumbers = JSON.parse(ticket.chosenNumbers);
      const matched = chosenNumbers.filter(num => winningNumbers.includes(num));
      if (matched.length >= 3) {
        winningTickets.push({ ...ticket, matchCount: matched.length });
      }
    }

    const prizePool = totalBetsCollected * (1 - houseEdge);
    let payoutPerWinner = 0;
    if (winningTickets.length > 0) {
      // Split pool equally among winners for simplicity in this MVP
      payoutPerWinner = prizePool / winningTickets.length;
    }

    let totalPayoutsCredited = 0;

    for (const ticket of tickets) {
      const isWinner = winningTickets.some(w => w.id === ticket.id);
      const payout = isWinner ? payoutPerWinner : 0;

      // Update ticket status
      await db.run(
        "UPDATE lottery_tickets SET claimed = 1, payout = ? WHERE id = ?",
        [payout, ticket.id]
      );

      if (payout > 0) {
        // Idempotency Key checks
        const idempotencyKey = `payout:draw_${activeDraw.id}:ticket_${ticket.id}`;
        
        await db.executeTransaction(async (tx) => {
          const alreadyProcessed = await tx.get(
            "SELECT id FROM transactions WHERE id = ?",
            [idempotencyKey]
          );

          if (!alreadyProcessed) {
            // Update user balance
            const user = await tx.get("SELECT balance, totalWon FROM users WHERE email = ?", [ticket.email]);
            if (user) {
              const newBalance = user.balance + payout;
              const totalWon = user.totalWon + payout;
              
              await tx.run(
                "UPDATE users SET balance = ?, totalWon = ? WHERE email = ?",
                [newBalance, totalWon, ticket.email]
              );

              // Add transaction record
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

    console.log(`[SCHEDULER] ["${lotteryName}"] Draw ID ${activeDraw.id} payout loop complete. Total winnings: $${totalPayoutsCredited}`);

    // Broadcast draw completion
    await pubsub.publish({
      type: 'DRAW_COMPLETED',
      lotteryName,
      drawId: activeDraw.id,
      winningNumbers,
      totalPayout: totalPayoutsCredited,
      timestamp: new Date().toISOString()
    });

    // 7. Initialize Next Draw session for this game
    await db.run(
      'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
      [lotteryName, 'OPEN', new Date().toISOString()]
    );
    console.log(`[SCHEDULER] ["${lotteryName}"] Next draw session initialized.`);

  } catch (error) {
    console.error(`[SCHEDULER] Error during drawing session of "${lotteryName}":`, error);
  }
};

/**
 * Launch Dynamic Schedulers
 */
const startScheduler = async () => {
  await db.initDatabase();
  await pubsub.connect(REDIS_URL);

  const syncDynamicWorkers = async () => {
    const gamesConfig = await db.all("SELECT * FROM games_config WHERE status = 'ACTIVE'");
    
    // Clear legacy workers
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
        await db.run(
          'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
          [game.name, 'OPEN', new Date().toISOString()]
        );
      }

      console.log(`[SCHEDULER] Configuring local interval loop for "${game.name}" (${intervalTime / 1000}s)`);
      
      activeLocalWorkers[game.name] = { active: false };
      
      const intervalId = setInterval(async () => {
        if (activeLocalWorkers[game.name].active) return;
        activeLocalWorkers[game.name].active = true;
        await executeLotteryDraw(game.name);
        activeLocalWorkers[game.name].active = false;
      }, intervalTime);

      activeLocalWorkers[game.name].intervalId = intervalId;
    }
  };

  await syncDynamicWorkers();

  // Listen to configuration updates from Backoffice API
  pubsub.on('message', async (event) => {
    if (event.type === 'GAME_CONFIG_UPDATED') {
      console.log('[SCHEDULER] Game configuration update detected. Resyncing workers...');
      await syncDynamicWorkers();
    }
  });
};

startScheduler().catch(err => {
  console.error('Fatal scheduler failure:', err);
});
