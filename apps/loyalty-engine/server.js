const express = require('express');
const cors = require('cors');
const { db, pubsub } = require('@cyber-casino/shared');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5002;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const TIER_THRESHOLDS = {
  BRONZE: 0,
  SILVER: 1000, // 1000 points = $1000 wagered
  GOLD: 5000    // 5000 points = $5000 wagered
};

const LEVEL_UP_BONUS = {
  SILVER: 50, // $50 cash bonus for hitting Silver
  GOLD: 250   // $250 cash bonus for hitting Gold
};

const init = async () => {
  await db.initDatabase();
  await pubsub.connect(REDIS_URL);

  console.log('[LOYALTY ENGINE] Subscribing to Pub/Sub events...');

  pubsub.on('message', async (data) => {
    if (data.type === 'TICKET_PURCHASED') {
      try {
        const { email, amount } = data;
        const pointsEarned = Math.floor(amount); // 1 point per $1 wagered

        if (pointsEarned > 0) {
          await db.executeTransaction(async (tx) => {
            let profile = await tx.get('SELECT * FROM loyalty_profiles WHERE LOWER(email) = ?', [email.toLowerCase()]);
            
            if (!profile) {
               await tx.run('INSERT INTO loyalty_profiles (email, points, tier) VALUES (?, 0, ?)', [email.toLowerCase(), 'BRONZE']);
               profile = { email: email.toLowerCase(), points: 0, tier: 'BRONZE' };
            }
            
            const newPoints = profile.points + pointsEarned;
            let newTier = 'BRONZE';
            if (newPoints >= TIER_THRESHOLDS.GOLD) newTier = 'GOLD';
            else if (newPoints >= TIER_THRESHOLDS.SILVER) newTier = 'SILVER';

            await tx.run('UPDATE loyalty_profiles SET points = ?, tier = ? WHERE LOWER(email) = ?', [newPoints, newTier, email.toLowerCase()]);

            // Handle automatic Level Up rewards
            if (newTier !== profile.tier) {
               console.log(`[LOYALTY] User ${email} leveled up to ${newTier}! Rewarding cash bonus.`);
               const bonusAmount = LEVEL_UP_BONUS[newTier] || 0;
               if (bonusAmount > 0) {
                  const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
                  await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [user.balance + bonusAmount, email.toLowerCase()]);
                  
                  // Add a transaction receipt for the wallet
                  await tx.run(
                    'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                    [`bonus-${Date.now()}-${Math.floor(Math.random() * 1000)}`, email.toLowerCase(), 'VIP_BONUS', bonusAmount, user.balance + bonusAmount, new Date().toISOString()]
                  );
               }
            }
          });
          
          console.log(`[LOYALTY] Awarded ${pointsEarned} points to ${email}`);
        }
      } catch(err) {
        console.error('[LOYALTY] Error processing purchase:', err);
      }
    }

    if (data.type === 'WAGER_PROCESSED') {
      try {
        const { email, wagerAmount } = data;
        const pointsEarned = Math.floor(wagerAmount); // 1 point per $1 wagered
        
        if (pointsEarned > 0) {
          await db.executeTransaction(async (tx) => {
            let profile = await tx.get('SELECT * FROM loyalty_profiles WHERE LOWER(email) = ?', [email.toLowerCase()]);
            
            if (!profile) {
               await tx.run('INSERT INTO loyalty_profiles (email, points, tier) VALUES (?, 0, ?)', [email.toLowerCase(), 'BRONZE']);
               profile = { email: email.toLowerCase(), points: 0, tier: 'BRONZE' };
            }
            
            const newPoints = profile.points + pointsEarned;
            let newTier = 'BRONZE';
            if (newPoints >= TIER_THRESHOLDS.GOLD) newTier = 'GOLD';
            else if (newPoints >= TIER_THRESHOLDS.SILVER) newTier = 'SILVER';

            await tx.run('UPDATE loyalty_profiles SET points = ?, tier = ? WHERE LOWER(email) = ?', [newPoints, newTier, email.toLowerCase()]);

            if (newTier !== profile.tier) {
               console.log(`[LOYALTY] User ${email} leveled up to ${newTier}! Rewarding cash bonus.`);
               const bonusAmount = LEVEL_UP_BONUS[newTier] || 0;
               if (bonusAmount > 0) {
                  const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
                  await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [user.balance + bonusAmount, email.toLowerCase()]);
                  
                  await tx.run(
                    'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                    [`bonus-${Date.now()}-${Math.floor(Math.random() * 1000)}`, email.toLowerCase(), 'VIP_BONUS', bonusAmount, user.balance + bonusAmount, new Date().toISOString()]
                  );
               }
            }
          });
          
          console.log(`[LOYALTY] Awarded ${pointsEarned} points for wager to ${email}`);
        }
      } catch (err) {
        console.error('[LOYALTY] Error processing wager:', err);
      }
    }
  });

  app.get('/api/loyalty/status', async (req, res) => {
    try {
      const { email } = req.query;
      if(!email) return res.status(400).json({ success: false, error: 'Email parameter missing' });
      
      let profile = await db.get('SELECT * FROM loyalty_profiles WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!profile) {
         profile = { email, points: 0, tier: 'BRONZE' };
      }
      
      res.json({ success: true, profile });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.listen(PORT, '0.0.0.0', () => console.log(`[LOYALTY ENGINE] Ready and listening on port ${PORT}`));
};

init().catch(console.error);
