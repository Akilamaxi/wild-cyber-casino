const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');
const { db, cryptoRng, pubsub } = require('@cyber-casino/shared');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const IS_PROD = process.env.NODE_ENV === 'production';

// Configurations for all 7 lottery games
const LOTTERY_GAMES = [
  {
    name: 'Sugar Rush 15',
    devInterval: 15000,      // 15 seconds
    prodInterval: 900000     // 15 minutes
  },
  {
    name: 'Sweet Treat 30',
    devInterval: 30000,      // 30 seconds
    prodInterval: 1800000    // 30 minutes
  },
  {
    name: 'Glazed Gold',
    devInterval: 60000,      // 1 minute
    prodInterval: 3600000    // 1 hour
  },
  {
    name: 'The Daily Dollop',
    devInterval: 120000,     // 2 minutes
    prodInterval: 86400000   // 1 day
  },
  {
    name: 'The Weekly Whiff',
    devInterval: 300000,     // 5 minutes
    prodInterval: 604800000  // 1 week
  },
  {
    name: 'The Grand Ganache',
    devInterval: 600000,     // 10 minutes
    prodInterval: 2592000000 // 1 month
  },
  {
    name: 'The Quarterly Banquet',
    devInterval: 900000,     // 15 minutes
    prodInterval: 7776000000 // 3 months
  }
];

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

    // 6. Process Payouts
    const tickets = await db.all("SELECT * FROM lottery_tickets WHERE drawId = ? AND claimed = 0", [activeDraw.id]);
    console.log(`[SCHEDULER] ["${lotteryName}"] Evaluating ${tickets.length} wagers...`);

    let totalPayoutsCredited = 0;

    for (const ticket of tickets) {
      const chosenNumbers = JSON.parse(ticket.chosenNumbers);
      const matched = chosenNumbers.filter(num => winningNumbers.includes(num));
      const matchCount = matched.length;

      let multiplier = 0;
      if (matchCount === 3) multiplier = 2;
      else if (matchCount === 4) multiplier = 10;
      else if (matchCount === 5) multiplier = 100;
      else if (matchCount === 6) multiplier = 10000;

      const payout = ticket.betAmount * multiplier;

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
 * Launch Schedulers for all games
 */
const startScheduler = async () => {
  await db.initDatabase();
  await pubsub.connect(REDIS_URL);

  for (const game of LOTTERY_GAMES) {
    const intervalTime = IS_PROD ? game.prodInterval : game.devInterval;
    
    // Auto-create initial open draw rows if missing
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

    if (pubsub.isRedisConnected) {
      console.log(`[SCHEDULER] Redis active. Configuring BullMQ repeatable loop for "${game.name}"...`);
      
      const lotteryQueue = new Queue(`lottery-${game.name.replace(/\s+/g, '-').toLowerCase()}`, { 
        connection: pubsub.redisPublisher 
      });
      
      await lotteryQueue.add(
        'run-draw',
        { lotteryName: game.name },
        {
          repeat: { every: intervalTime },
          removeOnComplete: true,
          removeOnFail: true
        }
      );

      const worker = new Worker(
        `lottery-${game.name.replace(/\s+/g, '-').toLowerCase()}`,
        async (job) => {
          if (job.name === 'run-draw') {
            await executeLotteryDraw(job.data.lotteryName);
          }
        },
        { connection: pubsub.redisSubscriber }
      );

      worker.on('failed', (job, err) => {
        console.error(`[BullMQ Worker] ["${game.name}"] Job failed:`, err);
      });

    } else {
      // In-Memory Fallback Interval loops
      console.log(`[SCHEDULER] Redis offline. Configuring local interval loop for "${game.name}" (${intervalTime / 1000}s)`);
      
      activeLocalWorkers[game.name] = false;
      
      setInterval(async () => {
        if (activeLocalWorkers[game.name]) return; // Prevent overlapping runs
        activeLocalWorkers[game.name] = true;
        await executeLotteryDraw(game.name);
        activeLocalWorkers[game.name] = false;
      }, intervalTime);
    }
  }
};

startScheduler().catch(err => {
  console.error('Fatal scheduler failure:', err);
});
