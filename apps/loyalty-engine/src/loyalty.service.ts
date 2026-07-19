import { Injectable } from '@nestjs/common';
import { DbService, PubSubService } from '@cyber-casino/shared';

const TIER_THRESHOLDS = {
  BRONZE: 0,
  SILVER: 1000,
  GOLD: 5000
};

const LEVEL_UP_BONUS = {
  SILVER: 50,
  GOLD: 250
};

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService
  ) {}

  async init() {
    await this.db.initDatabase();
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    await this.pubsub.connect(redisUrl);

    console.log('[LOYALTY ENGINE] Subscribing to Pub/Sub events...');
    this.pubsub.on('message', async (data: any) => {
      if (data.type === 'TICKET_PURCHASED') {
        await this.handlePointsAwarding(data.email, data.amount, 'ticket purchase');
      } else if (data.type === 'WAGER_PROCESSED') {
        await this.handlePointsAwarding(data.email, data.wagerAmount, 'wager');
      }
    });
  }

  private async handlePointsAwarding(email: string, amount: number, source: string) {
    try {
      const pointsEarned = Math.floor(amount);
      if (pointsEarned <= 0) return;

      await this.db.executeTransaction(async (tx: any) => {
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
      console.log(`[LOYALTY] Awarded ${pointsEarned} points for ${source} to ${email}`);
    } catch (err) {
      console.error(`[LOYALTY] Error processing ${source} points:`, err);
    }
  }

  async getProfile(email: string) {
    let profile = await this.db.get('SELECT * FROM loyalty_profiles WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!profile) {
      profile = { email, points: 0, tier: 'BRONZE' };
    }
    return profile;
  }
}
