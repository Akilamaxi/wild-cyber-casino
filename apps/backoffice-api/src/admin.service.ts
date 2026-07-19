import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService, PubSubService, CryptoRngService } from '@cyber-casino/shared';

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService,
    private readonly cryptoRng: CryptoRngService
  ) {}

  async init() {
    await this.db.initDatabase();
    await this.pubsub.connect(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  }

  async toggleKillSwitch(active: boolean) {
    const valueStr = active ? 'true' : 'false';
    await this.db.run(
      "INSERT OR REPLACE INTO game_settings (key, value) VALUES ('kill_switch_active', ?)",
      [valueStr]
    );
    await this.pubsub.publish({ type: 'KILL_SWITCH', active });
    return { success: true, killSwitchActive: active };
  }

  async getGames() {
    const games = await this.db.all('SELECT * FROM games_config');
    return { success: true, games };
  }

  async createGame(body: any) {
    const { id, name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status } = body;
    await this.db.run(
      'INSERT INTO games_config (id, name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, draw_interval_ms, ticket_price, max_tickets_per_user || 100, house_edge_percentage || 0.30, status || 'ACTIVE']
    );
    await this.pubsub.publish({ type: 'GAME_CONFIG_UPDATED' });
    return { success: true };
  }

  async updateGame(id: string, body: any) {
    const { name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status } = body;
    const oldGame = await this.db.get('SELECT name FROM games_config WHERE id = ?', [id]);

    await this.db.executeTransaction(async (tx: any) => {
      await tx.run(
        'UPDATE games_config SET name = ?, draw_interval_ms = ?, ticket_price = ?, max_tickets_per_user = ?, house_edge_percentage = ?, status = ? WHERE id = ?',
        [name, draw_interval_ms, ticket_price, max_tickets_per_user, house_edge_percentage, status, id]
      );
      
      if (oldGame && oldGame.name !== name) {
        await tx.run('UPDATE lottery_draws SET lotteryName = ? WHERE lotteryName = ?', [name, oldGame.name]);
        await tx.run('UPDATE lottery_ticket_pool SET lotteryName = ? WHERE lotteryName = ?', [name, oldGame.name]);
        await tx.run('UPDATE lottery_tickets SET lotteryName = ? WHERE lotteryName = ?', [name, oldGame.name]);
      }
    });
    
    await this.pubsub.publish({ type: 'GAME_CONFIG_UPDATED' });
    return { success: true };
  }

  async deleteGame(id: string) {
    const game = await this.db.get('SELECT id FROM games_config WHERE id = ?', [id]);
    if (!game) throw new NotFoundException('Lottery game not found.');
    await this.db.run('DELETE FROM games_config WHERE id = ?', [id]);
    await this.pubsub.publish({ type: 'GAME_CONFIG_UPDATED' });
    return { success: true };
  }

  async getSpinwheelPrizes() {
    const prizes = await this.db.all('SELECT * FROM spin_wheel_prizes ORDER BY display_order ASC, id ASC');
    return { success: true, prizes };
  }

  async createSpinwheelPrize(body: any) {
    const { text, color, textColor, mult, isBonus } = body;
    const maxOrderRow = await this.db.get('SELECT MAX(display_order) as max_order FROM spin_wheel_prizes');
    const nextOrder = (maxOrderRow && maxOrderRow.max_order !== null) ? parseInt(maxOrderRow.max_order, 10) + 1 : 0;
    
    await this.db.run(
      'INSERT INTO spin_wheel_prizes (text, color, textColor, mult, isBonus, display_order) VALUES (?, ?, ?, ?, ?, ?)',
      [text, color || '#ffffff', textColor || '#000000', parseFloat(mult) || 0.0, isBonus ? 1 : 0, nextOrder]
    );
    await this.pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    return { success: true };
  }

  async updateSpinwheelPrize(id: string, body: any) {
    const { text, color, textColor, mult, isBonus } = body;
    await this.db.run(
      'UPDATE spin_wheel_prizes SET text = ?, color = ?, textColor = ?, mult = ?, isBonus = ? WHERE id = ?',
      [text, color, textColor, parseFloat(mult) || 0.0, isBonus ? 1 : 0, id]
    );
    await this.pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    return { success: true };
  }

  async deleteSpinwheelPrize(id: string) {
    await this.db.run('DELETE FROM spin_wheel_prizes WHERE id = ?', [id]);
    await this.pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    return { success: true };
  }

  async reorderSpinwheelPrizes(orderedIds: string[]) {
    await this.db.executeTransaction(async (tx: any) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.run('UPDATE spin_wheel_prizes SET display_order = ? WHERE id = ?', [i, orderedIds[i]]);
      }
    });
    await this.pubsub.publish({ type: 'SPIN_WHEEL_CONFIG_UPDATED' });
    return { success: true };
  }

  async getSlotsConfig() {
    const config = await this.db.all('SELECT * FROM slots_config');
    const configMap: Record<string, string> = {};
    config.forEach((c: any) => configMap[c.key] = c.value);
    return { success: true, config: configMap };
  }

  async updateSlotsConfig(body: any) {
    const { payout_strategy, target_rtp, symbols_config } = body;
    
    await this.db.executeTransaction(async (tx: any) => {
      if (payout_strategy) {
        await tx.run('INSERT OR REPLACE INTO slots_config (key, value) VALUES ("payout_strategy", ?)', [payout_strategy]);
      }
      if (target_rtp !== undefined) {
        await tx.run('INSERT OR REPLACE INTO slots_config (key, value) VALUES ("target_rtp", ?)', [target_rtp.toString()]);
      }
      if (symbols_config) {
        JSON.parse(symbols_config);
        await tx.run('INSERT OR REPLACE INTO slots_config (key, value) VALUES ("symbols_config", ?)', [symbols_config]);
      }
    });

    await this.pubsub.publish({ type: 'SLOTS_CONFIG_UPDATED' });
    return { success: true };
  }

  async getDiceConfig() {
    const config = await this.db.all('SELECT * FROM dice_config');
    const configMap: Record<string, string> = {};
    config.forEach((c: any) => configMap[c.key] = c.value);
    return { success: true, config: configMap };
  }

  async updateDiceConfig(body: any) {
    const { mult_under_7, mult_exact_7, mult_over_7, mult_doubles } = body;
    await this.db.executeTransaction(async (tx: any) => {
      if (mult_under_7 !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_under_7", ?)', [mult_under_7.toString()]);
      if (mult_exact_7 !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_exact_7", ?)', [mult_exact_7.toString()]);
      if (mult_over_7 !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_over_7", ?)', [mult_over_7.toString()]);
      if (mult_doubles !== undefined) await tx.run('INSERT OR REPLACE INTO dice_config (key, value) VALUES ("mult_doubles", ?)', [mult_doubles.toString()]);
    });
    await this.pubsub.publish({ type: 'DICE_CONFIG_UPDATED' });
    return { success: true };
  }

  async createDiceTournament(body: any) {
    const { name, entry_fee, prize_pool, ends_at } = body;
    const fee = parseFloat(entry_fee);
    const pool = parseFloat(prize_pool);
    if (!name || isNaN(fee) || isNaN(pool) || fee < 0 || pool < 0) {
      throw new BadRequestException('Invalid tournament details.');
    }

    const finalEndsAt = ends_at || new Date(Date.now() + 86400000).toISOString();

    await this.db.run(
      'INSERT INTO dice_tournaments (name, entry_fee, prize_pool, status, created_at, ends_at) VALUES (?, ?, ?, "ACTIVE", ?, ?)',
      [name, fee, pool, new Date().toISOString(), finalEndsAt]
    );
    await this.pubsub.publish({ type: 'DICE_CONFIG_UPDATED' });
    return { success: true };
  }

  async completeDiceTournament(id: string, adminEmail: string) {
    const tourneyId = parseInt(id, 10);
    if (isNaN(tourneyId)) {
      throw new BadRequestException('Invalid tournament ID.');
    }

    const result = await this.db.executeTransaction(async (tx: any) => {
      const tourney = await tx.get('SELECT * FROM dice_tournaments WHERE id = ? AND status = "ACTIVE"', [tourneyId]);
      if (!tourney) throw new Error('Active tournament not found.');

      const leaderboard = await tx.all(`
        SELECT email, total_score
        FROM dice_tournament_participants
        WHERE tournament_id = ?
        ORDER BY total_score DESC, rolls_left ASC
      `, [tourneyId]);

      const payoutsLog: any[] = [];

      if (leaderboard.length > 0) {
        const pool = tourney.prize_pool;
        let distributions: number[] = [];
        if (leaderboard.length === 1) {
          distributions = [1.0];
        } else if (leaderboard.length === 2) {
          distributions = [0.70, 0.30];
        } else {
          distributions = [0.60, 0.30, 0.10];
        }

        for (let i = 0; i < Math.min(leaderboard.length, distributions.length); i++) {
          const share = distributions[i];
          const amount = pool * share;
          const participant = leaderboard[i];

          const user = await tx.get('SELECT balance, totalWon FROM users WHERE LOWER(email) = ?', [participant.email.toLowerCase()]);
          if (user) {
            const newBalance = user.balance + amount;
            const newTotalWon = user.totalWon + amount;
            await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [newBalance, newTotalWon, participant.email.toLowerCase()]);

            const winTxId = 'DICE-T-WIN-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            await tx.run(
              'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, "DICE_TOURNEY_PRIZE", ?, ?, ?)',
              [winTxId, participant.email.toLowerCase(), amount, newBalance, new Date().toISOString()]
            );

            payoutsLog.push({ email: participant.email, amount, rank: i + 1 });
          }
        }
      }

      await tx.run('UPDATE dice_tournaments SET status = "COMPLETED" WHERE id = ?', [tourneyId]);
      return { payouts: payoutsLog };
    });

    await this.pubsub.publish({ type: 'DICE_CONFIG_UPDATED' });
    return { success: true, payouts: result.payouts };
  }

  async getCrashConfig() {
    const config = await this.db.all('SELECT * FROM crash_config');
    const configMap: Record<string, string> = {};
    config.forEach((c: any) => configMap[c.key] = c.value);
    return { success: true, config: configMap };
  }

  async updateCrashConfig(body: any) {
    const { lobby_time_ms, house_edge, min_bet, max_bet, max_multiplier, crash_delay_ms } = body;
    await this.db.executeTransaction(async (tx: any) => {
      if (lobby_time_ms !== undefined) await tx.run("INSERT OR REPLACE INTO crash_config (key, value) VALUES ('lobby_time_ms', ?)", [lobby_time_ms.toString()]);
      if (house_edge !== undefined) await tx.run("INSERT OR REPLACE INTO crash_config (key, value) VALUES ('house_edge', ?)", [house_edge.toString()]);
      if (min_bet !== undefined) await tx.run("INSERT OR REPLACE INTO crash_config (key, value) VALUES ('min_bet', ?)", [min_bet.toString()]);
      if (max_bet !== undefined) await tx.run("INSERT OR REPLACE INTO crash_config (key, value) VALUES ('max_bet', ?)", [max_bet.toString()]);
      if (max_multiplier !== undefined) await tx.run("INSERT OR REPLACE INTO crash_config (key, value) VALUES ('max_multiplier', ?)", [max_multiplier.toString()]);
      if (crash_delay_ms !== undefined) await tx.run("INSERT OR REPLACE INTO crash_config (key, value) VALUES ('crash_delay_ms', ?)", [crash_delay_ms.toString()]);
    });
    await this.pubsub.publish({ type: 'CRASH_CONFIG_UPDATED' });
    return { success: true };
  }

  async getPlinkoConfig() {
    const config = await this.db.all('SELECT * FROM plinko_config');
    const configMap: Record<string, string> = {};
    config.forEach((c: any) => configMap[c.key] = c.value);
    return { success: true, config: configMap };
  }

  async updatePlinkoConfig(body: any) {
    const { house_edge, min_bet, max_bet, rtp_bias, throw_out_chance } = body;
    await this.db.executeTransaction(async (tx: any) => {
      if (house_edge !== undefined) await tx.run("INSERT OR REPLACE INTO plinko_config (key, value) VALUES ('house_edge', ?)", [house_edge.toString()]);
      if (min_bet !== undefined) await tx.run("INSERT OR REPLACE INTO plinko_config (key, value) VALUES ('min_bet', ?)", [min_bet.toString()]);
      if (max_bet !== undefined) await tx.run("INSERT OR REPLACE INTO plinko_config (key, value) VALUES ('max_bet', ?)", [max_bet.toString()]);
      if (rtp_bias !== undefined) await tx.run("INSERT OR REPLACE INTO plinko_config (key, value) VALUES ('rtp_bias', ?)", [rtp_bias.toString()]);
      if (throw_out_chance !== undefined) await tx.run("INSERT OR REPLACE INTO plinko_config (key, value) VALUES ('throw_out_chance', ?)", [throw_out_chance.toString()]);
    });
    await this.pubsub.publish({ type: 'PLINKO_CONFIG_UPDATED' });
    return { success: true };
  }

  async getAffiliateConfig() {
    const config = await this.db.all('SELECT * FROM affiliate_config');
    const configMap: Record<string, string> = {};
    config.forEach((c: any) => configMap[c.key] = c.value);
    return { success: true, config: configMap };
  }

  async updateAffiliateConfig(body: any) {
    const { 
      wager_commission_enabled, 
      bounty_referrer_amount, 
      bounty_referee_free_drops, 
      min_deposit_threshold, 
      min_wager_threshold 
    } = body;

    await this.db.executeTransaction(async (tx: any) => {
      if (wager_commission_enabled !== undefined) await tx.run("INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ('wager_commission_enabled', ?)", [wager_commission_enabled.toString()]);
      if (bounty_referrer_amount !== undefined) await tx.run("INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ('bounty_referrer_amount', ?)", [bounty_referrer_amount.toString()]);
      if (bounty_referee_free_drops !== undefined) await tx.run("INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ('bounty_referee_free_drops', ?)", [bounty_referee_free_drops.toString()]);
      if (min_deposit_threshold !== undefined) await tx.run("INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ('min_deposit_threshold', ?)", [min_deposit_threshold.toString()]);
      if (min_wager_threshold !== undefined) await tx.run("INSERT OR REPLACE INTO affiliate_config (key, value) VALUES ('min_wager_threshold', ?)", [min_wager_threshold.toString()]);
    });
    return { success: true };
  }

  async getAffiliateShadowLogs() {
    const logs = await this.db.all('SELECT * FROM shadow_commission_logs ORDER BY timestamp DESC LIMIT 100');
    return { success: true, logs };
  }

  async verifyAudit(drawId: string) {
    const drawIdInt = parseInt(drawId, 10);
    if (isNaN(drawIdInt)) {
      throw new BadRequestException('Invalid draw ID.');
    }

    const audit = await this.db.get('SELECT * FROM audit_rng_logs WHERE drawId = ?', [drawIdInt]);
    if (!audit) {
      throw new NotFoundException('RNG Audit trail not found for this draw ID.');
    }

    const winningNumbers = JSON.parse(audit.winningNumbers);
    const isVerified = this.cryptoRng.verifyDrawNumbers(audit.seed, audit.salt, winningNumbers);

    return {
      success: true,
      drawId: drawIdInt,
      verified: isVerified,
      seed: audit.seed,
      salt: audit.salt,
      hash: audit.hash,
      winningNumbers,
      timestamp: audit.timestamp
    };
  }

  async getSecurityAlerts() {
    const alerts = await this.db.all('SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 100');
    return { success: true, alerts };
  }

  async resolveSecurityAlert(id: string, adminEmail: string) {
    const alertId = parseInt(id, 10);
    await this.db.run('UPDATE security_alerts SET resolved = 1 WHERE id = ?', [alertId]);
    
    await this.db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, details, created_at) VALUES (?, "RESOLVE_ALERT", ?, ?)',
      [adminEmail || 'admin@test.com', `Resolved security alert ID: ${alertId}`, new Date().toISOString()]
    );

    return { success: true };
  }

  async updateUserStatus(email: string, status: string, adminEmail: string) {
    if (!['ACTIVE', 'FROZEN', 'BANNED'].includes(status)) {
      throw new BadRequestException('Invalid status value.');
    }

    await this.db.run('UPDATE users SET status = ? WHERE LOWER(email) = ?', [status, email.toLowerCase()]);

    if (status === 'FROZEN' || status === 'BANNED') {
      if (this.pubsub.isRedisConnected && this.pubsub.redisPublisher) {
        await this.pubsub.redisPublisher.set(`blacklist:${email.toLowerCase()}`, 'true', 'EX', 86400);
      }
    } else {
      if (this.pubsub.isRedisConnected && this.pubsub.redisPublisher) {
        await this.pubsub.redisPublisher.del(`blacklist:${email.toLowerCase()}`);
      }
    }

    await this.db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, target_email, details, created_at) VALUES (?, "UPDATE_USER_STATUS", ?, ?, ?)',
      [adminEmail || 'admin@test.com', email.toLowerCase(), `Updated status to: ${status}`, new Date().toISOString()]
    );

    return { success: true };
  }

  async getUserTags(email: string) {
    const tags = await this.db.all('SELECT tag FROM user_tags WHERE LOWER(email) = ?', [email.toLowerCase()]);
    return { success: true, tags: tags.map((t: any) => t.tag) };
  }

  async updateUserTags(email: string, tags: string[], adminEmail: string) {
    if (!Array.isArray(tags)) {
      throw new BadRequestException('Tags must be an array.');
    }

    await this.db.run('DELETE FROM user_tags WHERE LOWER(email) = ?', [email.toLowerCase()]);
    for (const tag of tags) {
      await this.db.run('INSERT INTO user_tags (email, tag) VALUES (?, ?)', [email.toLowerCase(), tag]);
    }

    await this.db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, target_email, details, created_at) VALUES (?, "UPDATE_USER_TAGS", ?, ?, ?)',
      [adminEmail || 'admin@test.com', email.toLowerCase(), `Updated tags to: ${tags.join(', ')}`, new Date().toISOString()]
    );

    return { success: true };
  }

  async getBonusRules() {
    const rules = await this.db.all('SELECT * FROM bonus_rules ORDER BY id DESC');
    return { success: true, rules };
  }

  async createBonusRule(body: any) {
    const { ruleName, triggerType, threshold, rewardType, rewardAmount, adminEmail } = body;
    const thresh = parseFloat(threshold);
    const amt = parseFloat(rewardAmount);
    if (!ruleName || !triggerType || isNaN(thresh) || !rewardType || isNaN(amt)) {
      throw new BadRequestException('Invalid trigger details.');
    }

    const reward = JSON.stringify({ type: rewardType, amount: amt });

    await this.db.run(
      'INSERT INTO bonus_rules (rule_name, trigger_type, threshold, bonus_reward, active) VALUES (?, ?, ?, ?, 1)',
      [ruleName, triggerType, thresh, reward]
    );

    await this.db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, details, created_at) VALUES (?, "CREATE_BONUS_RULE", ?, ?)',
      [adminEmail || 'admin@test.com', `Created bonus rule: ${ruleName} (Threshold: ${thresh}, Reward: ${rewardType} ${amt})`, new Date().toISOString()]
    );

    return { success: true };
  }

  async toggleBonusRule(id: string, active: boolean, adminEmail: string) {
    const ruleId = parseInt(id, 10);
    await this.db.run('UPDATE bonus_rules SET active = ? WHERE id = ?', [active ? 1 : 0, ruleId]);

    await this.db.run(
      'INSERT INTO admin_audit_trail (admin_email, action, details, created_at) VALUES (?, "TOGGLE_BONUS_RULE", ?, ?)',
      [adminEmail || 'admin@test.com', `Toggled rule ID: ${ruleId} to active=${active}`, new Date().toISOString()]
    );

    return { success: true };
  }

  async getUser360View(email: string) {
    const user = await this.db.get('SELECT email, username, balance, gamesPlayed, totalWon, role, status, wallet_address FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const tags = await this.db.all('SELECT tag FROM user_tags WHERE LOWER(email) = ?', [email.toLowerCase()]);
    const sessions = await this.db.all('SELECT ip_address, user_agent, country, city, created_at FROM user_session_logs WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 10', [email.toLowerCase()]);
    const transactions = await this.db.all('SELECT id, type, amount, balanceAfter, timestamp FROM transactions WHERE LOWER(email) = ? ORDER BY timestamp DESC LIMIT 20', [email.toLowerCase()]);
    const alerts = await this.db.all('SELECT id, alert_type, severity, details, resolved, created_at FROM security_alerts WHERE LOWER(email) = ? ORDER BY created_at DESC', [email.toLowerCase()]);

    return {
      success: true,
      user: {
        ...user,
        tags: tags.map((t: any) => t.tag),
        sessions,
        transactions,
        alerts
      }
    };
  }

  async getGameLogs() {
    const plinko = await this.db.all(
      'SELECT id, email, risk, destination_bin, payout, multiplier, wager_amount, rows, server_seed, client_seed, nonce, timestamp FROM plinko_drops ORDER BY id DESC LIMIT 50'
    );
    const dice = await this.db.all('SELECT id, name, status, entry_fee, created_at, ends_at FROM dice_tournaments ORDER BY id DESC LIMIT 50');
    const crash = await this.db.all('SELECT id, crash_point, status, created_at FROM crash_games ORDER BY id DESC LIMIT 50');
    const slots = await this.db.all(
      "SELECT id, email, type, amount, balanceAfter as balance_after, timestamp FROM transactions WHERE type IN ('SLOTS_PLAY','SLOTS_WINOUT') ORDER BY timestamp DESC LIMIT 50"
    );
    return { success: true, plinko, dice, crash, slots };
  }

  async getAffiliateStats() {
    const totalReferrals = await this.db.get('SELECT COUNT(*) as count FROM referrals');
    const completedReferrals = await this.db.get("SELECT COUNT(*) as count FROM referrals WHERE status = 'COMPLETED'");
    const totalCommissions = await this.db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'REFERRAL_COMMISSION'");
    const shadowTotal = await this.db.get('SELECT COALESCE(SUM(potential_commission), 0) as total FROM shadow_commission_logs');
    return {
      success: true,
      stats: {
        totalReferrals: totalReferrals?.count || 0,
        completedReferrals: completedReferrals?.count || 0,
        conversionRate: totalReferrals?.count > 0 ? ((completedReferrals?.count / totalReferrals?.count) * 100).toFixed(1) : '0.0',
        totalCommissionsPaid: parseFloat(totalCommissions?.total || 0).toFixed(2),
        shadowLoggedCommissions: parseFloat(shadowTotal?.total || 0).toFixed(4)
      }
    };
  }

  async getAuditLogs() {
    const logs = await this.db.all('SELECT * FROM admin_audit_trail ORDER BY created_at DESC LIMIT 100');
    return { success: true, logs };
  }
}
