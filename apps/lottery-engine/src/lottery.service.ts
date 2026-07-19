import { Injectable, BadRequestException, NotFoundException, ForbiddenException, UnauthorizedException, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as geoip from 'geoip-lite';
import { DbService, PubSubService, CryptoRngService } from '@cyber-casino/shared';
import { LotteryGateway } from './lottery.gateway';
import { CrashService } from './crash.service';

const localBlacklist = new Set<string>();

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required.');
  return secret;
};

const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
};

const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  if (!stored.startsWith('scrypt$')) {
    const supplied = Buffer.from(password);
    const legacy = Buffer.from(stored);
    return supplied.length === legacy.length && crypto.timingSafeEqual(supplied, legacy);
  }
  const [, n, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const decodeBase32 = (value: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid MFA secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  return Buffer.from((bits.match(/.{8}/g) || []).map(byte => parseInt(byte, 2)));
};

const verifyTotp = (secret: string, code: string) => {
  const key = decodeBase32(secret);
  const current = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(offset => {
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(current + offset));
    const digest = crypto.createHmac('sha1', key).update(counter).digest();
    const position = digest[digest.length - 1] & 0x0f;
    const number = (digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000;
    const expected = Buffer.from(number.toString().padStart(6, '0'));
    const supplied = Buffer.from(String(code || ''));
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  });
};

const PLINKO_MULTIPLIERS: Record<number, Record<string, number[]>> = {
  8: {
    Low: [5.6, 1.6, 1.1, 1.0, 0.4, 1.0, 1.1, 1.6, 5.6],
    Medium: [13, 3, 1.3, 0.7, 0.1, 0.7, 1.3, 3, 13],
    High: [29, 4, 1.5, 0.3, 0.0, 0.3, 1.5, 4, 29]
  },
  9: {
    Low: [5.6, 2.0, 1.6, 1.0, 0.5, 0.5, 1.0, 1.6, 2.0, 5.6],
    Medium: [18, 4, 1.7, 0.9, 0.2, 0.2, 0.9, 1.7, 4, 18],
    High: [43, 7, 2.0, 0.6, 0.0, 0.0, 0.6, 2.0, 7, 43]
  },
  10: {
    Low: [8.9, 3.0, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 3.0, 8.9],
    Medium: [22, 5, 2.0, 1.4, 0.5, 0.1, 0.5, 1.4, 2.0, 5, 22],
    High: [76, 10, 3.0, 0.9, 0.2, 0.0, 0.2, 0.9, 3.0, 10, 76]
  },
  11: {
    Low: [8.9, 3.0, 1.7, 1.1, 1.0, 0.6, 0.6, 1.0, 1.1, 1.7, 3.0, 8.9],
    Medium: [24, 6, 3.0, 1.8, 0.5, 0.2, 0.2, 0.5, 1.8, 3.0, 6, 24],
    High: [120, 14, 4.3, 1.4, 0.2, 0.0, 0.0, 0.2, 1.4, 4.3, 14, 120]
  },
  12: {
    Low: [10, 4.0, 2.0, 1.6, 1.1, 1.0, 0.5, 1.0, 1.1, 1.6, 2.0, 4.0, 10],
    Medium: [33, 11, 4.0, 2.0, 1.1, 0.4, 0.1, 0.4, 1.1, 2.0, 4.0, 11, 33],
    High: [170, 24, 8.1, 2.0, 0.5, 0.1, 0.0, 0.1, 0.5, 2.0, 8.1, 24, 170]
  },
  13: {
    Low: [10, 4.0, 2.0, 1.6, 1.2, 1.0, 0.6, 0.6, 1.0, 1.2, 1.6, 2.0, 4.0, 10],
    Medium: [43, 13, 6.0, 3.0, 1.3, 0.5, 0.2, 0.2, 0.5, 1.3, 3.0, 6.0, 13, 43],
    High: [260, 37, 11, 4.0, 1.0, 0.1, 0.0, 0.0, 0.1, 1.0, 4.0, 11, 37, 260]
  },
  14: {
    Low: [16, 7.0, 4.0, 1.9, 1.4, 1.0, 0.5, 0.5, 0.5, 1.0, 1.4, 1.9, 4.0, 7.0, 16],
    Medium: [58, 15, 7.0, 4.0, 1.9, 1.0, 0.4, 0.1, 0.4, 1.0, 1.9, 4.0, 7.0, 15, 58],
    High: [420, 56, 18, 5.0, 1.9, 0.2, 0.0, 0.0, 0.0, 0.2, 1.9, 5.0, 18, 56, 420]
  },
  15: {
    Low: [16, 7.0, 4.0, 1.9, 1.4, 1.1, 1.0, 0.6, 0.6, 1.0, 1.1, 1.4, 1.9, 4.0, 7.0, 16],
    Medium: [88, 18, 9.0, 5.0, 2.5, 1.3, 0.4, 0.1, 0.1, 0.4, 1.3, 2.5, 5.0, 9.0, 18, 88],
    High: [620, 83, 27, 8.0, 3.0, 0.5, 0.1, 0.0, 0.0, 0.1, 0.5, 3.0, 8.0, 27, 83, 620]
  },
  16: {
    Low: [16, 9.0, 2.0, 1.4, 1.3, 1.1, 1.0, 0.5, 0.5, 0.5, 1.0, 1.1, 1.3, 1.4, 2.0, 9.0, 16],
    Medium: [110, 41, 10, 5.0, 3.0, 1.5, 1.0, 0.3, 0.1, 0.3, 1.0, 1.5, 3.0, 5.0, 10, 41, 110],
    High: [1000, 130, 26, 9.0, 4.0, 2.0, 0.2, 0.0, 0.0, 0.0, 0.2, 2.0, 4.0, 9.0, 26, 130, 1000]
  }
};

@Injectable()
export class LotteryService implements OnModuleInit {
  private isKillSwitchActive = false;

  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService,
    private readonly cryptoRng: CryptoRngService,
    @Inject(forwardRef(() => LotteryGateway))
    private readonly gateway: LotteryGateway,
    @Inject(forwardRef(() => CrashService))
    private readonly crashService: CrashService
  ) {}

  async onModuleInit() {
    await this.db.initDatabase();
    await this.pubsub.connect(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

    // Read initial Kill-Switch state from settings
    const gs = await this.db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
    this.isKillSwitchActive = gs ? gs.value === 'true' : false;

    // Emergency kill switch listener
    this.pubsub.on('message', (message: any) => {
      if (message && message.type === 'KILL_SWITCH') {
        this.isKillSwitchActive = message.active;
        console.log(`[LOTTERY ENGINE] Kill-switch status updated via Pub/Sub: ${this.isKillSwitchActive}`);
      }
    });
  }

  private generateTxId() {
    return 'TX-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  private checkKillSwitch() {
    if (this.isKillSwitchActive) {
      throw new ForbiddenException('Draw operations are currently disabled by administrator.');
    }
  }

  private async createSession(user: any) {
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { email: user.email, username: user.username, role: user.role, jti, typ: 'access' }, getJwtSecret(),
      { expiresIn: (process.env.JWT_ACCESS_TTL || '15m') as any, issuer: process.env.JWT_ISSUER || 'cyber-casino', audience: process.env.JWT_AUDIENCE || 'cyber-casino-api', algorithm: 'HS256' },
    );
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.db.run(
      'INSERT INTO refresh_sessions (id, email, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      [crypto.randomUUID(), user.email.toLowerCase(), tokenHash, new Date(Date.now() + 7 * 86400000).toISOString(), new Date().toISOString()],
    );
    return { token, refreshToken };
  }

  async refreshSession(refreshToken: string) {
    if (!refreshToken) throw new ForbiddenException('Refresh session is missing.');
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    return this.db.executeTransaction(async (tx: any) => {
      const session = await tx.get('SELECT * FROM refresh_sessions WHERE token_hash = ? FOR UPDATE', [hash]);
      if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
        if (session?.email) await tx.run('UPDATE refresh_sessions SET revoked_at = ? WHERE LOWER(email) = ? AND revoked_at IS NULL', [new Date().toISOString(), session.email.toLowerCase()]);
        throw new ForbiddenException('Refresh session is invalid or has been reused.');
      }
      await tx.run('UPDATE refresh_sessions SET revoked_at = ? WHERE id = ?', [new Date().toISOString(), session.id]);
      const user = await tx.get('SELECT email, username, balance, gamesPlayed, totalWon, role, status FROM users WHERE LOWER(email) = ?', [session.email.toLowerCase()]);
      if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('Account is unavailable.');
      const next = await this.createSession(user);
      return { user, ...next };
    });
  }

  async revokeRefreshSession(refreshToken: string) {
    if (!refreshToken) return;
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.db.run('UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [new Date().toISOString(), hash]);
  }

  async authenticateRequest(req: Request): Promise<any> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ForbiddenException('Unauthorized: Missing token.');
    }
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'cyber-casino',
        audience: process.env.JWT_AUDIENCE || 'cyber-casino-api',
      }) as any;
      const isBlacklisted = await this.isJtiBlacklisted(decoded.jti);
      if (isBlacklisted) {
        throw new ForbiddenException('Unauthorized: Session revoked.');
      }
      const user = await this.db.get('SELECT status FROM users WHERE LOWER(email) = ?', [decoded.email.toLowerCase()]);
      if (!user) {
        throw new ForbiddenException('Unauthorized: User not found.');
      }
      if (user.status === 'FROZEN' || user.status === 'BANNED') {
        throw new ForbiddenException(`Account is ${user.status}.`);
      }
      return decoded;
    } catch (e: any) {
      throw new ForbiddenException(e.message || 'Unauthorized: Invalid token.');
    }
  }

  private async isJtiBlacklisted(jti: string): Promise<boolean> {
    if (this.pubsub.isRedisConnected && this.pubsub.redisPublisher) {
      try {
        const val = await this.pubsub.redisPublisher.get(`blacklist:${jti}`);
        return val !== null;
      } catch (e) {
        return localBlacklist.has(jti);
      }
    }
    return localBlacklist.has(jti);
  }

  private async logSessionAndCheckAlerts(email: string, ip: string, userAgent: string, deviceFingerprint: string, mockGeo: any = null) {
    try {
      let country = 'LK', city = 'Colombo', lat = 6.9271, lon = 79.8612;
      const geo = geoip.lookup(ip);
      if (geo) {
        country = geo.country || 'Unknown';
        city = geo.city || 'Unknown';
        lat = geo.ll[0];
        lon = geo.ll[1];
      } else if (mockGeo) {
        country = mockGeo.country || country;
        city = mockGeo.city || city;
        lat = mockGeo.lat !== undefined ? mockGeo.lat : lat;
        lon = mockGeo.lon !== undefined ? mockGeo.lon : lon;
      }

      const now = new Date().toISOString();
      const lastSession = await this.db.get(
        'SELECT * FROM user_session_logs WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 1',
        [email.toLowerCase()]
      );

      if (lastSession) {
        const distKm = this.getDistanceFromLatLonInKm(lastSession.latitude, lastSession.longitude, lat, lon);
        const timeHours = (new Date(now).getTime() - new Date(lastSession.created_at).getTime()) / 3600000;

        if (distKm > 10 && timeHours > 0) {
          const speed = distKm / timeHours;
          if (speed > 1000) {
            await this.db.run(
              `INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, 'IMPOSSIBLE_TRAVEL', 'HIGH', ?, 0, ?)`,
              [
                email.toLowerCase(),
                `Impossible Travel detected: moved ${distKm.toFixed(0)} km in ${(timeHours * 60).toFixed(1)} mins (speed: ${speed.toFixed(0)} km/h). Last: ${lastSession.city}, ${lastSession.country}. Current: ${city}, ${country}.`,
                now
              ]
            );
            await this.db.run(`UPDATE users SET status = 'FROZEN' WHERE LOWER(email) = ?`, [email.toLowerCase()]);
            console.warn(`[SECURITY] Account ${email} frozen due to Impossible Travel.`);
          }
        }
      }

      await this.db.run(
        'INSERT INTO user_session_logs (email, ip_address, user_agent, device_fingerprint, country, city, latitude, longitude, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [email.toLowerCase(), ip, userAgent, deviceFingerprint, country, city, lat, lon, now]
      );

      const sameIpUsers = await this.db.all(
        'SELECT DISTINCT LOWER(email) as email FROM user_session_logs WHERE ip_address = ? AND LOWER(email) != ?',
        [ip, email.toLowerCase()]
      );
      const sameFingerprintUsers = await this.db.all(
        'SELECT DISTINCT LOWER(email) as email FROM user_session_logs WHERE device_fingerprint = ? AND LOWER(email) != ?',
        [deviceFingerprint, email.toLowerCase()]
      );

      if (sameIpUsers.length > 0 || sameFingerprintUsers.length > 0) {
        const matchEmails = new Set<string>();
        sameIpUsers.forEach((u: any) => matchEmails.add(u.email));
        sameFingerprintUsers.forEach((u: any) => matchEmails.add(u.email));

        if (matchEmails.size > 0) {
          await this.db.run(
            `INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, 'MULTI_ACCOUNT', 'MEDIUM', ?, 0, ?)`,
            [
              email.toLowerCase(),
              `Shared footprint matches: ${Array.from(matchEmails).join(', ')} (Matching IP: ${sameIpUsers.length > 0}, Matching Fingerprint: ${sameFingerprintUsers.length > 0})`,
              now
            ]
          );
        }
      }
    } catch (err) {
      console.error('[SECURITY] Error running security rules:', err);
    }
  }

  private getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }

  async login(email: string, password, deviceFingerprint, ip: string, userAgent, mockGeo, mfaCode?: string) {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required.');
    }
    const user = await this.db.get(
      'SELECT email, username, password, balance, gamesPlayed, totalWon, role, status FROM users WHERE LOWER(email) = ?',
      [email.toLowerCase()]
    );
    if (!user || !(await verifyPassword(String(password), user.password))) {
      throw new UnauthorizedException('Invalid email or password credentials.');
    }
    if (!user.password.startsWith('scrypt$')) {
      await this.db.run('UPDATE users SET password = ? WHERE LOWER(email) = ?', [await hashPassword(password), email.toLowerCase()]);
    }
    delete user.password;
    if (user.status === 'FROZEN' || user.status === 'BANNED') {
      throw new ForbiddenException(`Account is ${user.status}.`);
    }
    if (user.role === 'ADMIN' && process.env.ADMIN_MFA_SECRET) {
      if (!mfaCode || !verifyTotp(process.env.ADMIN_MFA_SECRET, mfaCode)) throw new ForbiddenException('A valid administrator MFA code is required.');
    } else if (user.role === 'ADMIN' && process.env.NODE_ENV === 'production' && process.env.ADMIN_MFA_REQUIRED !== 'false') {
      throw new ForbiddenException('Administrator MFA is not configured.');
    }

    await this.logSessionAndCheckAlerts(user.email, ip, userAgent, deviceFingerprint || 'unknown-fingerprint', mockGeo);

    const freshStatus = await this.db.get('SELECT status FROM users WHERE LOWER(email) = ?', [user.email.toLowerCase()]);
    if (freshStatus && (freshStatus.status === 'FROZEN' || freshStatus.status === 'BANNED')) {
      throw new ForbiddenException(`Account is ${freshStatus.status}. Login blocked by security system.`);
    }

    return { user, ...(await this.createSession(user)) };
  }

  async register(body: any, ip: string, userAgent, mockGeo) {
    const { username, email, password, referralCode, deviceFingerprint, walletAddress } = body;
    if (!username || !email || !password) {
      throw new BadRequestException('All registration fields are required.');
    }

    const result = await this.db.executeTransaction(async (tx: any) => {
      const existing = await tx.get('SELECT email FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (existing) {
        throw new Error('Email address is already registered.');
      }
      const orphanRef = await tx.get('SELECT email FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (orphanRef) {
        await tx.run('DELETE FROM user_referral_codes WHERE LOWER(email) = ?', [email.toLowerCase()]);
        await tx.run('DELETE FROM user_affiliate_wallets WHERE LOWER(email) = ?', [email.toLowerCase()]);
      }

      const ownReferralCode = 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      let referrerEmail = null;
      if (referralCode) {
        const referrer = await tx.get('SELECT email FROM user_referral_codes WHERE LOWER(referral_code) = ?', [referralCode.toLowerCase()]);
        if (referrer) {
          referrerEmail = referrer.email;
        }
      }

      await tx.run(
        `INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, status, wallet_address) VALUES (?, ?, ?, 1000.0, 0, 0.0, 'ACTIVE', ?)`,
        [email.toLowerCase(), username, await hashPassword(String(password)), walletAddress || null]
      );
      await tx.run(
        'INSERT OR REPLACE INTO user_referral_codes (email, referral_code, referred_by) VALUES (?, ?, ?)',
        [email.toLowerCase(), ownReferralCode, referrerEmail]
      );
      await tx.run(
        `INSERT OR IGNORE INTO user_affiliate_wallets (email, commission_balance, total_network_volume, current_rank) VALUES (?, 0.0, 0.0, 'BRONZE')`,
        [email.toLowerCase()]
      );

      if (referrerEmail) {
        const referralId = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        await tx.run(
          `INSERT OR IGNORE INTO referrals (id, referrer_email, referee_email, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)`,
          [referralId, referrerEmail, email.toLowerCase(), new Date().toISOString()]
        );
      }

      const txId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, 1000.0, 1000.0, ?)',
        [txId, email.toLowerCase(), 'WELCOME_BONUS', new Date().toISOString()]
      );

      return { email: email.toLowerCase(), username, balance: 1000.0, gamesPlayed: 0, totalWon: 0.0, role: 'USER' };
    });

    await this.logSessionAndCheckAlerts(result.email, ip, userAgent, deviceFingerprint || 'unknown-fingerprint', mockGeo);

    const freshUser = await this.db.get('SELECT status FROM users WHERE LOWER(email) = ?', [result.email]);
    if (freshUser && (freshUser.status === 'FROZEN' || freshUser.status === 'BANNED')) {
      throw new ForbiddenException(`Account flagged and ${freshUser.status} during registration security check.`);
    }

    return { user: result, ...(await this.createSession(result)) };
  }

  async getLeaderboard() {
    return this.db.all('SELECT username, gamesPlayed, totalWon FROM users ORDER BY totalWon DESC LIMIT 10');
  }

  async getSpinwheelPrizes() {
    const prizes = await this.db.all('SELECT * FROM spin_wheel_prizes ORDER BY display_order ASC, id ASC');
    return prizes.map((p: any) => ({
      id: p.id,
      text: p.text,
      color: p.color,
      textColor: p.textColor,
      mult: p.mult,
      isBonus: p.isBonus === 1
    }));
  }

  async spin(email: string) {
    if (!email) throw new BadRequestException('Email required.');
    const SPIN_COST = 10.0;

    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < SPIN_COST) throw new Error('Insufficient wallet funds.');

      let balance = user.balance - SPIN_COST;
      const gamesPlayed = (user.gamesPlayed !== undefined ? parseInt(user.gamesPlayed) : (user.gamesplayed !== undefined ? parseInt(user.gamesplayed) : 0)) + 1;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [balance, gamesPlayed, email.toLowerCase()]);
      
      const playTxId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [playTxId, email.toLowerCase(), 'SPIN_PLAY', -SPIN_COST, balance, new Date().toISOString()]
      );

      const dbPrizes = await tx.all('SELECT * FROM spin_wheel_prizes ORDER BY display_order ASC, id ASC');
      const prizes = dbPrizes.length > 0 ? dbPrizes.map((p: any) => ({
        text: p.text,
        mult: p.mult,
        isBonus: p.isBonus === 1
      })) : [
        { text: '10% CASHBACK', mult: 0.1, isBonus: true },
        { text: 'TRY AGAIN', mult: 0.0, isBonus: false },
        { text: 'FREE $10', mult: 1.0, isBonus: false },
        { text: 'NO LUCK', mult: 0.0, isBonus: false },
        { text: 'JACKPOT x5', mult: 5.0, isBonus: false },
        { text: '20% BONUS', mult: 0.2, isBonus: true }
      ];
      
      const winningIndex = crypto.randomInt(0, prizes.length);
      const prize = prizes[winningIndex];
      const payout = SPIN_COST * prize.mult;
      let totalWon = (user.totalWon !== undefined ? parseFloat(user.totalWon) : (user.totalwon !== undefined ? parseFloat(user.totalwon) : 0))

      if (payout > 0) {
        balance += payout;
        totalWon += payout;
        await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [balance, totalWon, email.toLowerCase()]);

        const winTxId = this.generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [winTxId, email.toLowerCase(), 'SPIN_WINOUT', payout, balance, new Date().toISOString()]
        );
      }

      return { winningIndex, prizeText: prize.text, newBalance: balance, gamesPlayed, totalWon };
    });
  }

  async getSlotsConfig() {
    const strategy = await this.db.get("SELECT value FROM slots_config WHERE key = 'payout_strategy'");
    const rtp = await this.db.get("SELECT value FROM slots_config WHERE key = 'target_rtp'");
    const symbols = await this.db.get("SELECT value FROM slots_config WHERE key = 'symbols_config'");
    return {
      payout_strategy: strategy ? strategy.value : 'FAIR_RNG',
      target_rtp: rtp ? rtp.value : '0.90',
      symbols_config: symbols ? symbols.value : '[]'
    };
  }

  async slotsSpin(email: string, bet: any) {
    const betAmount = Number(bet);
    if (!email || !Number.isFinite(betAmount) || betAmount <= 0 || betAmount > 10_000) {
      throw new BadRequestException('Invalid slots bet details.');
    }
    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      const currentBalance = Number(user.balance);
      if (!Number.isFinite(currentBalance)) throw new Error('Invalid wallet balance.');
      if (currentBalance < betAmount) throw new Error('Insufficient wallet funds.');

      let balance = currentBalance - betAmount;
      const parsedGamesPlayed = Number(user.gamesPlayed ?? user.gamesplayed ?? 0);
      const parsedTotalWon = Number(user.totalWon ?? user.totalwon ?? 0);
      const userGamesPlayed = Number.isSafeInteger(parsedGamesPlayed) && parsedGamesPlayed >= 0 ? parsedGamesPlayed : 0;
      let userTotalWon = Number.isFinite(parsedTotalWon) && parsedTotalWon >= 0 ? parsedTotalWon : 0;
      const gamesPlayed = userGamesPlayed + 1;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [balance, gamesPlayed, email.toLowerCase()]);

      const playTxId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [playTxId, email.toLowerCase(), 'SLOTS_PLAY', -betAmount, balance, new Date().toISOString()]
      );

      const strategyRow = await tx.get("SELECT value FROM slots_config WHERE key = 'payout_strategy'");
      const rtpRow = await tx.get("SELECT value FROM slots_config WHERE key = 'target_rtp'");
      const symbolsRow = await tx.get("SELECT value FROM slots_config WHERE key = 'symbols_config'");

      const strategy = strategyRow ? strategyRow.value : 'FAIR_RNG';
      const targetRtp = rtpRow ? parseFloat(rtpRow.value) : 0.90;
      const symbols = symbolsRow ? JSON.parse(symbolsRow.value) : [
        { name: 'BAR', multiplier: 3, weight: 30 },
        { name: 'CHERRY', multiplier: 5, weight: 25 },
        { name: 'BELL', multiplier: 10, weight: 20 },
        { name: 'DIAMOND', multiplier: 20, weight: 15 },
        { name: 'SEVEN', multiplier: 50, weight: 8 },
        { name: 'WILD', multiplier: 100, weight: 2 }
      ];

      const rollReelsByWeights = (symbolsList: any[]) => {
        const totalWeight = symbolsList.reduce((acc, s) => acc + s.weight, 0);
        const rollOne = () => {
          let rand = crypto.randomInt(0, totalWeight);
          for (const s of symbolsList) {
            if (rand < s.weight) return s.name;
            rand -= s.weight;
          }
          return symbolsList[0].name;
        };
        return [rollOne(), rollOne(), rollOne()];
      };

      let reels = rollReelsByWeights(symbols);

      const calculatePayout = (outcome: string[], symsList: any[], betVal: number) => {
        if (outcome[0] === outcome[1] && outcome[1] === outcome[2]) {
          const multipliers: Record<string, number> = {};
          symsList.forEach(s => multipliers[s.name] = s.multiplier);
          return betVal * (multipliers[outcome[0]] || 0);
        }
        return 0;
      };

      let payout = calculatePayout(reels, symbols, betAmount);

      if (strategy === 'CONTROLLED_RTP') {
        const stats = await tx.get(`
          SELECT 
            ABS(SUM(CASE WHEN type = 'SLOTS_PLAY' THEN amount ELSE 0 END)) as total_bet,
            SUM(CASE WHEN type = 'SLOTS_WINOUT' THEN amount ELSE 0 END) as total_won
          FROM transactions
          WHERE LOWER(email) = ?
        `, [email.toLowerCase()]);

        const statsTotalBet = stats && stats.totalBet !== undefined ? parseFloat(stats.totalBet) : (stats && stats.total_bet !== undefined ? parseFloat(stats.total_bet) : 0);
        const statsTotalWon = stats && stats.totalWon !== undefined ? parseFloat(stats.totalWon) : (stats && stats.total_won !== undefined ? parseFloat(stats.total_won) : 0);

        const totalBet = statsTotalBet + betAmount;
        const totalWon = statsTotalWon + payout;
        const currentRtp = totalBet > 0 ? (totalWon / totalBet) : 0;

        if (currentRtp > targetRtp && payout > betAmount * 2) {
          let attempts = 0;
          while (attempts < 20) {
            reels = rollReelsByWeights(symbols);
            payout = calculatePayout(reels, symbols, betAmount);
            if (payout <= betAmount * 2) break;
            attempts++;
          }
        }
      } else if (strategy === 'NEAR_MISS_TEASER') {
        if (payout === 0 && crypto.randomInt(0, 100) < 50) {
          const premiumSymbols = ['SEVEN', 'DIAMOND', 'BELL'];
          const targetSym = premiumSymbols[crypto.randomInt(0, premiumSymbols.length)];
          const otherSymbols = symbols.filter((s: any) => s.name !== targetSym && s.name !== 'WILD');
          const finalOther = otherSymbols[crypto.randomInt(0, otherSymbols.length)].name;
          reels = [targetSym, targetSym, finalOther];
          reels.sort(() => 0.5 - Math.random());
          payout = 0;
        }
      }

      if (payout > 0) {
        balance += payout;
        userTotalWon += payout;
        await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [balance, userTotalWon, email.toLowerCase()]);

        const winTxId = this.generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [winTxId, email.toLowerCase(), 'SLOTS_WINOUT', payout, balance, new Date().toISOString()]
        );
      }

      await this.routeWagerCommission(email, betAmount, 'SLOTS', tx);
      await this.checkAndTriggerBounty(email, tx);

      return { reels, payout, newBalance: balance, gamesPlayed, totalWon: userTotalWon };
    });
  }

  async getPlinkoHistory(email: string) {
    if (!email) throw new BadRequestException('Email parameter missing');
    return this.db.all(
      'SELECT id, wager_amount, rows, risk, multiplier, payout, timestamp FROM plinko_drops WHERE LOWER(email) = ? ORDER BY timestamp DESC LIMIT 20',
      [email.toLowerCase()]
    );
  }

  private generatePlinkoPath(serverSeed: string, clientSeed: string, nonce: number, rows: number, biasFactor = 8, throwOutChance = 0.02) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    
    const firstByte = parseInt(hash.substring(0, 2), 16);
    const isThrowOut = (firstByte % 100) < (throwOutChance * 100);
    const pathSteps: number[] = [];

    if (isThrowOut) {
      const throwDir = (firstByte & 1);
      for (let r = 0; r < rows; r++) {
        if (r < 2) {
          const hexByte = hash.substring(r * 2 + 2, r * 2 + 4);
          const byteVal = parseInt(hexByte, 16);
          pathSteps.push(byteVal >= 128 ? 1 : 0);
        } else {
          pathSteps.push(throwDir);
        }
      }
      const destinationBin = throwDir === 1 ? 999 : -1;
      return { path: pathSteps, destinationBin };
    }

    let rightCount = 0;
    let leftCount = 0;

    for (let r = 0; r < rows; r++) {
      const currentX = rightCount - leftCount;
      let threshold = 128 + currentX * biasFactor;
      threshold = Math.max(15, Math.min(240, threshold));

      const hexByte = hash.substring(r * 2, r * 2 + 2);
      const byteVal = parseInt(hexByte, 16);
      const step = byteVal >= threshold ? 1 : 0;
      
      pathSteps.push(step);
      if (step === 1) {
        rightCount++;
      } else {
        leftCount++;
      }
    }

    return { path: pathSteps, destinationBin: rightCount };
  }

  async plinkoDrop(body: any) {
    const { email, wagerAmount, rows, risk } = body;
    if (!email || !wagerAmount || !rows || !risk) {
      throw new BadRequestException('All fields are required.');
    }
    const wager = parseFloat(wagerAmount);
    const rowCount = parseInt(rows, 10);

    if (isNaN(wager) || wager <= 0) {
      throw new BadRequestException('Wager amount must be positive.');
    }
    if (rowCount < 8 || rowCount > 16) {
      throw new BadRequestException('Rows must be between 8 and 16.');
    }
    if (!['Low', 'Medium', 'High'].includes(risk)) {
      throw new BadRequestException('Invalid risk tier.');
    }

    const configs = await this.db.all('SELECT * FROM plinko_config');
    const configMap: Record<string, string> = {};
    configs.forEach((c: any) => configMap[c.key] = c.value);

    const minBet = parseFloat(configMap.min_bet) || 1;
    const maxBet = parseFloat(configMap.max_bet) || 1000;
    const biasFactor = configMap.rtp_bias !== undefined ? parseInt(configMap.rtp_bias, 10) : 8;
    const throwOutChance = configMap.throw_out_chance !== undefined ? parseFloat(configMap.throw_out_chance) : 0.02;

    if (wager < minBet || wager > maxBet) {
      throw new BadRequestException(`Wager must be between $${minBet} and $${maxBet}.`);
    }

    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User account not found.');
      if (user.balance < wager) throw new Error('Insufficient wallet balance.');

      const lockedBalance = user.balance - wager;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [lockedBalance, (user.gamesPlayed !== undefined ? parseInt(user.gamesPlayed) : (user.gamesplayed !== undefined ? parseInt(user.gamesplayed) : 0)) + 1, email.toLowerCase()]);

      const wagerTxId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [wagerTxId, email.toLowerCase(), 'PLINKO_DROP', -wager, lockedBalance, new Date().toISOString()]
      );

      const serverSeed = crypto.randomBytes(32).toString('hex');
      const clientSeed = crypto.randomBytes(16).toString('hex');
      const nonce = (user.gamesPlayed !== undefined ? parseInt(user.gamesPlayed) : (user.gamesplayed !== undefined ? parseInt(user.gamesplayed) : 0)) + 1;

      const { path: dropPath, destinationBin } = this.generatePlinkoPath(serverSeed, clientSeed, nonce, rowCount, biasFactor, throwOutChance);

      let multiplier = 0;
      let payout = 0;
      
      if (destinationBin === -1 || destinationBin === 999) {
        multiplier = 0.0;
        payout = 0.0;
      } else {
        multiplier = PLINKO_MULTIPLIERS[rowCount][risk][destinationBin];
        payout = wager * multiplier;
      }
      
      const finalBalance = lockedBalance + payout;
      await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [finalBalance, (user.totalWon !== undefined ? parseFloat(user.totalWon) : (user.totalwon !== undefined ? parseFloat(user.totalwon) : 0))+ payout, email.toLowerCase()]);

      if (payout > 0) {
        const payoutTxId = this.generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [payoutTxId, email.toLowerCase(), 'PLINKO_WINOUT', payout, finalBalance, new Date().toISOString()]
        );
      }

      await tx.run(
        'INSERT INTO plinko_drops (email, wager_amount, rows, risk, path, destination_bin, multiplier, payout, server_seed, client_seed, nonce, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [email.toLowerCase(), wager, rowCount, risk, JSON.stringify(dropPath), destinationBin, multiplier, payout, serverSeed, clientSeed, nonce, new Date().toISOString()]
      );

      await this.routeWagerCommission(email, wager, 'PLINKO', tx);
      await this.checkAndTriggerBounty(email, tx);

      return {
        path: dropPath,
        multiplier,
        payout,
        newBalance: finalBalance,
        serverSeed,
        clientSeed,
        nonce,
        destinationBin
      };
    });
  }

  async getWallet(email: string) {
    const user = await this.db.get('SELECT balance, wallet_address FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) throw new NotFoundException('User not found.');

    const transactions = await this.db.all(
      'SELECT id, type, amount, balanceAfter, timestamp FROM transactions WHERE LOWER(email) = ? ORDER BY timestamp DESC LIMIT 50',
      [email.toLowerCase()]
    );
    return { balance: user.balance, walletAddress: user.wallet_address, transactions };
  }

  async setWalletAddress(email: string, walletAddress: string) {
    if (!walletAddress) throw new BadRequestException('Wallet address is required.');

    await this.db.run('UPDATE users SET wallet_address = ? WHERE LOWER(email) = ?', [walletAddress, email.toLowerCase()]);

    const duplicate = await this.db.all(
      'SELECT LOWER(email) as email FROM users WHERE wallet_address = ? AND LOWER(email) != ?',
      [walletAddress, email.toLowerCase()]
    );

    if (duplicate.length > 0) {
      const matchEmails = duplicate.map((d: any) => d.email).join(', ');
      await this.db.run(
        `INSERT INTO security_alerts (email, alert_type, severity, details, resolved, created_at) VALUES (?, 'MULTI_ACCOUNT', 'MEDIUM', ?, 0, ?)`,
        [
          email.toLowerCase(),
          `Shared withdrawal wallet address matched with: ${matchEmails}`,
          new Date().toISOString()
        ]
      );
    }
  }

  async deposit(email: string, amount: any) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') {
      throw new ForbiddenException('Direct deposits are disabled. Use the verified payment-provider webhook.');
    }
    const depAmount = parseFloat(amount);
    if (!email || !Number.isFinite(depAmount) || depAmount <= 0 || depAmount > 1_000_000) {
      throw new BadRequestException('Invalid deposit values.');
    }

    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get(
        'UPDATE users SET balance = balance + ? WHERE LOWER(email) = ? RETURNING balance',
        [depAmount, email.toLowerCase()],
      );
      if (!user) throw new Error('User not found.');
      const newBalance = user.balance;

      const txId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [txId, email.toLowerCase(), 'DEPOSIT', depAmount, newBalance, new Date().toISOString()]
      );
      const ledgerTime = new Date().toISOString();
      await tx.run('INSERT INTO ledger_entries (id, transaction_id, email, account, direction, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), txId, email.toLowerCase(), 'PLAYER_WALLET', 'CREDIT', depAmount, 'USD', ledgerTime]);
      await tx.run('INSERT INTO ledger_entries (id, transaction_id, email, account, direction, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), txId, email.toLowerCase(), 'PLATFORM_CLEARING', 'DEBIT', depAmount, 'USD', ledgerTime]);

      await this.checkAndTriggerBounty(email, tx);
      return newBalance;
    });
  }

  async processPaymentWebhook(body: any, headers: { signature: string; timestamp: string; nonce: string }) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || secret.length < 32) throw new ForbiddenException('Payment verification is unavailable.');
    const timestamp = Number(headers.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) throw new ForbiddenException('Payment timestamp is outside the accepted window.');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(headers.nonce)) throw new ForbiddenException('Invalid payment nonce.');
    const payload = `${headers.timestamp}.${headers.nonce}.${JSON.stringify(body)}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const supplied = Buffer.from(headers.signature, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (supplied.length !== expectedBytes.length || !crypto.timingSafeEqual(supplied, expectedBytes)) throw new ForbiddenException('Invalid payment signature.');

    return this.db.executeTransaction(async (tx: any) => {
      const prior = await tx.get('SELECT nonce FROM payment_webhook_nonces WHERE provider = ? AND nonce = ?', ['default', headers.nonce]);
      if (prior) throw new ForbiddenException('Payment callback has already been processed.');
      await tx.run('INSERT INTO payment_webhook_nonces (provider, nonce, received_at) VALUES (?, ?, ?)', ['default', headers.nonce, new Date().toISOString()]);
      const amount = Number(body.amount);
      const user = await tx.get('UPDATE users SET balance = balance + ? WHERE LOWER(email) = ? RETURNING balance', [amount, body.email.toLowerCase()]);
      if (!user) throw new BadRequestException('Payment account not found.');
      const txId = `PAY-${body.providerTransactionId}`;
      const now = new Date().toISOString();
      await tx.run('INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [txId, body.email.toLowerCase(), 'DEPOSIT', amount, user.balance, now]);
      await tx.run('INSERT INTO ledger_entries (id, transaction_id, email, account, direction, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), txId, body.email.toLowerCase(), 'PLAYER_WALLET', 'CREDIT', amount, body.currency, now]);
      await tx.run('INSERT INTO ledger_entries (id, transaction_id, email, account, direction, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), txId, body.email.toLowerCase(), 'PLATFORM_CLEARING', 'DEBIT', amount, body.currency, now]);
      return { transactionId: txId, newBalance: user.balance };
    });
  }

  async withdraw(email: string, amount: any) {
    const witAmount = parseFloat(amount);
    if (!email || !Number.isFinite(witAmount) || witAmount <= 0 || witAmount > 1_000_000) {
      throw new BadRequestException('Invalid withdrawal values.');
    }

    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get(
        'UPDATE users SET balance = balance - ? WHERE LOWER(email) = ? AND balance >= ? RETURNING balance',
        [witAmount, email.toLowerCase(), witAmount],
      );
      if (!user) throw new Error('User not found or insufficient wallet balance.');
      const newBalance = user.balance;

      const txId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [txId, email.toLowerCase(), 'WITHDRAWAL', -witAmount, newBalance, new Date().toISOString()]
      );
      const ledgerTime = new Date().toISOString();
      await tx.run('INSERT INTO ledger_entries (id, transaction_id, email, account, direction, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), txId, email.toLowerCase(), 'PLAYER_WALLET', 'DEBIT', witAmount, 'USD', ledgerTime]);
      await tx.run('INSERT INTO ledger_entries (id, transaction_id, email, account, direction, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), txId, email.toLowerCase(), 'PLATFORM_CLEARING', 'CREDIT', witAmount, 'USD', ledgerTime]);

      return newBalance;
    });
  }

  async getLotteryGames() {
    return this.db.all("SELECT * FROM games_config WHERE status = 'ACTIVE'");
  }

  async getLotteryStatus(email: string, lotteryName: string) {
    const name = lotteryName || 'Sugar Rush 15';
    let currentDraw = await this.db.get(
      'SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1',
      [name]
    );
    
    if (!currentDraw) {
      await this.db.run(
        'INSERT INTO lottery_draws (lotteryName, state, timestamp) VALUES (?, ?, ?)',
        [name, 'OPEN', new Date().toISOString()]
      );
      currentDraw = await this.db.get(
        'SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1',
        [name]
      );
    }

    let tickets: any[] = [];
    if (email) {
      tickets = await this.db.all(
        'SELECT id, chosenNumbers, betAmount, claimed, payout, timestamp FROM lottery_tickets WHERE LOWER(email) = ? AND drawId = ? AND lotteryName = ? ORDER BY id DESC',
        [email.toLowerCase(), currentDraw.id, name]
      );

      if (tickets.length === 0) {
        const lastCompletedDraw = await this.db.get(
          "SELECT id FROM lottery_draws WHERE lotteryName = ? AND state = 'COMPLETED' ORDER BY id DESC LIMIT 1",
          [name]
        );
        if (lastCompletedDraw) {
          tickets = await this.db.all(
            'SELECT id, chosenNumbers, betAmount, claimed, payout, timestamp FROM lottery_tickets WHERE LOWER(email) = ? AND drawId = ? AND lotteryName = ? ORDER BY id DESC',
            [email.toLowerCase(), lastCompletedDraw.id, name]
          );
        }
      }
    }

    return { 
      draw: {
        id: currentDraw.id,
        lotteryName: currentDraw.lotteryName,
        state: currentDraw.state,
        winningNumbers: currentDraw.winningNumbers ? JSON.parse(currentDraw.winningNumbers) : null,
        timestamp: currentDraw.timestamp
      },
      tickets: tickets.map(t => ({
        ...t,
        chosenNumbers: JSON.parse(t.chosenNumbers)
      }))
    };
  }

  async getLotteryHistory(email: string) {
    const tickets = await this.db.all(`
      SELECT 
        t.id, 
        t.lotteryName, 
        t.drawId, 
        t.chosenNumbers, 
        t.betAmount, 
        t.claimed, 
        t.payout, 
        t.timestamp,
        d.winningNumbers,
        d.state as drawState
      FROM lottery_tickets t
      LEFT JOIN lottery_draws d ON t.drawId = d.id AND t.lotteryName = d.lotteryName
      WHERE LOWER(t.email) = ?
      ORDER BY t.id DESC
    `, [email.toLowerCase()]);

    return tickets.map((t: any) => ({
      id: t.id,
      lotteryName: t.lotteryName,
      drawId: t.drawId,
      chosenNumbers: JSON.parse(t.chosenNumbers),
      betAmount: t.betAmount,
      claimed: t.claimed,
      payout: t.payout,
      timestamp: t.timestamp,
      winningNumbers: t.winningNumbers ? JSON.parse(t.winningNumbers) : null,
      drawState: t.drawState
    }));
  }

  async getLotteryWinners(gameName: string) {
    const draws = await this.db.all(
      `SELECT d.id as drawId, d.winningNumbers, d.timestamp,
              (SELECT COUNT(*) FROM lottery_tickets WHERE drawId = d.id AND payout > 0) as winnersCount,
              (SELECT SUM(payout) FROM lottery_tickets WHERE drawId = d.id) as totalPaidOut
       FROM lottery_draws d
       WHERE d.lotteryName = ? AND d.state = 'COMPLETED'
       ORDER BY d.id DESC LIMIT 5`,
      [gameName]
    );

    return draws.map((d: any) => ({
      drawId: d.drawId,
      winningNumbers: d.winningNumbers ? JSON.parse(d.winningNumbers) : null,
      timestamp: d.timestamp,
      winnersCount: d.winnersCount || 0,
      totalPaidOut: d.totalPaidOut || 0.0
    }));
  }

  async getLotteryPoolTickets(email: string, lotteryName: string) {
    const name = lotteryName || 'Sugar Rush 15';
    const draw = await this.db.get(
      "SELECT id FROM lottery_draws WHERE state = 'OPEN' AND lotteryName = ? ORDER BY id DESC LIMIT 1",
      [name]
    );
    if (!draw) return [];

    const nowIso = new Date().toISOString();
    let poolTickets = await this.db.all(`
      SELECT * FROM lottery_ticket_pool 
      WHERE lotteryName = ? AND drawId = ? 
        AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reservedUntil < ?))
      ORDER BY RANDOM() LIMIT 5
    `, [name, draw.id, nowIso]);

    if (poolTickets.length < 5) {
      console.log(`[LOTTERY ENGINE] Auto-generating ticket pool of 100 tickets for Draw ID ${draw.id} of ${name}...`);
      const totalTickets = 100;
      const pool = [];
      const generateUniqueNumbers = () => {
        const nums = new Set();
        while (nums.size < 6) {
          nums.add(Math.floor(Math.random() * 49) + 1);
        }
        return Array.from(nums).sort((a, b) => (a as number) - (b as number));
      };

      for (let i = 0; i < totalTickets; i++) {
        pool.push(generateUniqueNumbers());
      }

      await this.db.executeTransaction(async (tx: any) => {
        for (const ticketNumbers of pool) {
          await tx.run(
            'INSERT INTO lottery_ticket_pool (lotteryName, drawId, chosenNumbers, status) VALUES (?, ?, ?, ?)',
            [name, draw.id, JSON.stringify(ticketNumbers), 'AVAILABLE']
          );
        }
      });

      poolTickets = await this.db.all(`
        SELECT * FROM lottery_ticket_pool 
        WHERE lotteryName = ? AND drawId = ? 
          AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reservedUntil < ?))
        ORDER BY RANDOM() LIMIT 5
      `, [name, draw.id, nowIso]);
    }

    return poolTickets.map((t: any) => ({
      id: t.id,
      lotteryName: t.lotteryName,
      drawId: t.drawId,
      chosenNumbers: JSON.parse(t.chosenNumbers),
      status: t.status
    }));
  }

  async reserveTickets(email: string, ticketId, ticketIds) {
    this.checkKillSwitch();
    const ids = Array.isArray(ticketIds) ? ticketIds : (ticketId ? [ticketId] : []);
    if (!email || ids.length === 0) {
      throw new BadRequestException('Missing reservation parameters.');
    }

    const nowIso = new Date().toISOString();
    const reservedUntil = new Date(Date.now() + 30000).toISOString();

    return this.db.executeTransaction(async (tx: any) => {
      for (const id of ids) {
        const ticket = await tx.get("SELECT * FROM lottery_ticket_pool WHERE id = ?", [id]);
        if (!ticket) throw new Error(`Ticket #${id} not found in pool.`);
        
        const isAvailable = ticket.status === 'AVAILABLE' || 
                            (ticket.status === 'RESERVED' && ticket.reservedUntil < nowIso);
        if (!isAvailable) {
          throw new Error(`Ticket #${id} has already been reserved by another player.`);
        }

        const draw = await tx.get("SELECT state FROM lottery_draws WHERE id = ?", [ticket.drawId]);
        if (!draw || draw.state !== 'OPEN') {
          throw new Error('Draw session is locked or drawing. Reservation denied.');
        }
      }

      for (const id of ids) {
        await tx.run(
          "UPDATE lottery_ticket_pool SET status = 'RESERVED', reservedBy = ?, reservedUntil = ? WHERE id = ?",
          [email.toLowerCase(), reservedUntil, id]
        );
      }
      return { ticketIds: ids, reservedUntil };
    });
  }

  async releaseTickets(email: string, ticketId, ticketIds) {
    const ids = Array.isArray(ticketIds) ? ticketIds : (ticketId ? [ticketId] : []);
    if (!email || ids.length === 0) {
      throw new BadRequestException('Missing release parameters.');
    }
    for (const id of ids) {
      await this.db.run(
        "UPDATE lottery_ticket_pool SET status = 'AVAILABLE', reservedBy = NULL, reservedUntil = NULL WHERE id = ? AND LOWER(reservedBy) = ?",
        [id, email.toLowerCase()]
      );
    }
  }

  async checkoutTickets(email: string, ticketId, ticketIds) {
    this.checkKillSwitch();
    const ids = Array.isArray(ticketIds) ? ticketIds : (ticketId ? [ticketId] : []);
    if (!email || ids.length === 0) {
      throw new BadRequestException('Missing checkout parameters.');
    }

    const nowIso = new Date().toISOString();

    const result = await this.db.executeTransaction(async (tx: any) => {
      let totalBetAmount = 0;
      const verifiedPoolTickets = [];
      let lotteryName = '';
      let drawId = null;

      for (const id of ids) {
        const poolTicket = await tx.get(
          "SELECT * FROM lottery_ticket_pool WHERE id = ? AND LOWER(reservedBy) = ? AND status = 'RESERVED'",
          [id, email.toLowerCase()]
        );
        if (!poolTicket) {
          throw new Error(`No active reservation found for Ticket #${id}.`);
        }
        if (poolTicket.reservedUntil < nowIso) {
          throw new Error(`Reservation timeout! Ticket #${id} reservation has expired.`);
        }

        const gameConfig = await tx.get('SELECT * FROM games_config WHERE name = ? AND status = ?', [poolTicket.lotteryName, 'ACTIVE']);
        if (!gameConfig) {
          throw new Error(`Active game configuration not found for ${poolTicket.lotteryName}.`);
        }

        totalBetAmount += gameConfig.ticket_price;
        verifiedPoolTickets.push(poolTicket);
        lotteryName = poolTicket.lotteryName;
        drawId = poolTicket.drawId;
      }

      if (drawId) {
        const draw = await tx.get('SELECT * FROM lottery_draws WHERE id = ? AND state = ?', [drawId, 'OPEN']);
        if (!draw) {
          throw new Error('The draw session has locked or finished. Checkout failed.');
        }
      }

      const user = await tx.get('SELECT balance, gamesPlayed FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < totalBetAmount) throw new Error('Insufficient wallet funds to complete purchase.');

      const newBalance = user.balance - totalBetAmount;
      const gamesPlayed = (user.gamesPlayed !== undefined ? parseInt(user.gamesPlayed) : (user.gamesplayed !== undefined ? parseInt(user.gamesplayed) : 0)) + ids.length;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [newBalance, gamesPlayed, email.toLowerCase()]);

      for (const poolTicket of verifiedPoolTickets) {
        await tx.run("UPDATE lottery_ticket_pool SET status = 'PURCHASED' WHERE id = ?", [poolTicket.id]);
        await tx.run(
          'INSERT INTO lottery_tickets (email, lotteryName, drawId, chosenNumbers, betAmount, claimed, payout, timestamp) VALUES (?, ?, ?, ?, ?, 0, 0.0, ?)',
          [email.toLowerCase(), poolTicket.lotteryName, poolTicket.drawId, poolTicket.chosenNumbers, totalBetAmount / ids.length, new Date().toISOString()]
        );
      }

      const txId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [txId, email.toLowerCase(), 'LOTTERY_PLAY', -totalBetAmount, newBalance, new Date().toISOString()]
      );

      return { newBalance, drawId, lotteryName, totalBetAmount };
    });

    await this.pubsub.publish({
      type: 'TICKET_PURCHASED',
      email: email.toLowerCase(),
      lotteryName: result.lotteryName,
      amount: result.totalBetAmount,
      timestamp: new Date().toISOString()
    });

    this.gateway.server.emit('lottery_events', { type: 'TICKET_PURCHASED' });
    return result;
  }

  async getDiceConfig() {
    const config = await this.db.all('SELECT * FROM dice_config');
    const configMap: Record<string, string> = {};
    config.forEach((c: any) => configMap[c.key] = c.value);
    return configMap;
  }

  async rollSingle(email: string, bet: any, prediction: string) {
    const betAmount = parseFloat(bet);
    if (!email || isNaN(betAmount) || betAmount <= 0 || !prediction) {
      throw new BadRequestException('Invalid dice bet details.');
    }

    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get('SELECT balance, gamesPlayed, totalWon FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < betAmount) throw new Error('Insufficient wallet funds.');

      const die1 = crypto.randomInt(1, 7);
      const die2 = crypto.randomInt(1, 7);
      const sum = die1 + die2;
      const isDouble = die1 === die2;

      let balance = user.balance - betAmount;
      const gamesPlayed = (user.gamesPlayed !== undefined ? parseInt(user.gamesPlayed) : (user.gamesplayed !== undefined ? parseInt(user.gamesplayed) : 0)) + 1;
      await tx.run('UPDATE users SET balance = ?, gamesPlayed = ? WHERE LOWER(email) = ?', [balance, gamesPlayed, email.toLowerCase()]);

      const multUnderRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_under_7'");
      const multExactRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_exact_7'");
      const multOverRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_over_7'");
      const multDoublesRow = await tx.get("SELECT value FROM dice_config WHERE key = 'mult_doubles'");

      const multUnder = multUnderRow ? parseFloat(multUnderRow.value) : 2.3;
      const multExact = multExactRow ? parseFloat(multExactRow.value) : 5.8;
      const multOver = multOverRow ? parseFloat(multOverRow.value) : 2.3;
      const multDoubles = multDoublesRow ? parseFloat(multDoublesRow.value) : 5.8;

      let win = false;
      let multiplier = 0;
      if (prediction === 'UNDER_7' && sum < 7) {
        win = true;
        multiplier = multUnder;
      } else if (prediction === 'EXACT_7' && sum === 7) {
        win = true;
        multiplier = multExact;
      } else if (prediction === 'OVER_7' && sum > 7) {
        win = true;
        multiplier = multOver;
      } else if (prediction === 'DOUBLES' && isDouble) {
        win = true;
        multiplier = multDoubles;
      }

      let payout = win ? betAmount * multiplier : 0;
      let totalWon = (user.totalWon !== undefined ? parseFloat(user.totalWon) : (user.totalwon !== undefined ? parseFloat(user.totalwon) : 0))

      if (payout > 0) {
        balance += payout;
        totalWon += payout;
        await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [balance, totalWon, email.toLowerCase()]);

        const winTxId = this.generateTxId();
        await tx.run(
          'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [winTxId, email.toLowerCase(), 'DICE_WIN', payout, balance, new Date().toISOString()]
        );
      }

      const playTxId = this.generateTxId();
      await tx.run(
        'INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [playTxId, email.toLowerCase(), 'DICE_PLAY', -betAmount, balance - payout, new Date().toISOString()]
      );

      await this.routeWagerCommission(email, betAmount, 'DICE', tx);
      await this.checkAndTriggerBounty(email, tx);

      return { die1, die2, sum, payout, win, newBalance: balance };
    });
  }

  async getDiceTournaments() {
    return this.db.all('SELECT * FROM dice_tournaments ORDER BY id DESC');
  }

  async joinTournament(email: string, tournamentId: any) {
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) throw new BadRequestException('Invalid details.');

    const result = await this.db.executeTransaction(async (tx: any) => {
      const tourney = await tx.get(`SELECT * FROM dice_tournaments WHERE id = ? AND status = 'ACTIVE'`, [tourneyIdInt]);
      if (!tourney) throw new Error('Active tournament not found.');
      if (tourney.ends_at && new Date(tourney.ends_at) < new Date()) {
        throw new Error('Tournament has already ended.');
      }

      const participant = await tx.get('SELECT * FROM dice_tournament_participants WHERE tournament_id = ? AND LOWER(email) = ?', [tourneyIdInt, email.toLowerCase()]);
      if (participant) return { alreadyJoined: true };

      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < tourney.entry_fee) throw new Error('Insufficient balance for entry fee.');

      const balance = user.balance - tourney.entry_fee;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [balance, email.toLowerCase()]);

      const newPrizePool = tourney.prize_pool + tourney.entry_fee;
      await tx.run('UPDATE dice_tournaments SET prize_pool = ? WHERE id = ?', [newPrizePool, tourneyIdInt]);

      await tx.run('INSERT INTO dice_tournament_participants (tournament_id, email, rolls_left, total_score, completed) VALUES (?, ?, 10, 0, 0)', [tourneyIdInt, email.toLowerCase()]);

      const txId = this.generateTxId();
      await tx.run(
        `INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'DICE_TOURNEY_ENTRY', ?, ?, ?)`,
        [txId, email.toLowerCase(), -tourney.entry_fee, balance, new Date().toISOString()]
      );

      return { success: true, newBalance: balance, alreadyJoined: false };
    });

    if (result.success || result.alreadyJoined) {
      this.gateway.server.emit('dice_events', { type: 'DICE_LEADERBOARD_UPDATED', tournamentId: tourneyIdInt, email });
    }
    return result;
  }

  async tournamentRoll(email: string, tournamentId: any) {
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) throw new BadRequestException('Invalid details.');

    const result = await this.db.executeTransaction(async (tx: any) => {
      const tourney = await tx.get(`SELECT * FROM dice_tournaments WHERE id = ? AND status = 'ACTIVE'`, [tourneyIdInt]);
      if (!tourney) throw new Error('Tournament is no longer active.');
      if (tourney.ends_at && new Date(tourney.ends_at) < new Date()) {
        throw new Error('Tournament has already ended.');
      }

      const participant = await tx.get('SELECT * FROM dice_tournament_participants WHERE tournament_id = ? AND LOWER(email) = ?', [tourneyIdInt, email.toLowerCase()]);
      if (!participant) throw new Error('You are not registered in this tournament.');
      if (participant.rolls_left <= 0) throw new Error('No rolls remaining for this tournament.');

      const die1 = crypto.randomInt(1, 7);
      const die2 = crypto.randomInt(1, 7);
      const sum = die1 + die2;

      const newRollsLeft = participant.rolls_left - 1;
      const newScore = participant.total_score + sum;
      const isCompleted = newRollsLeft === 0 ? 1 : 0;

      await tx.run(
        'UPDATE dice_tournament_participants SET rolls_left = ?, total_score = ?, completed = ? WHERE tournament_id = ? AND LOWER(email) = ?',
        [newRollsLeft, newScore, isCompleted, tourneyIdInt, email.toLowerCase()]
      );

      return { die1, die2, sum, rollsLeft: newRollsLeft, totalScore: newScore, completed: isCompleted };
    });

    if (result.sum !== undefined) {
      this.gateway.server.emit('dice_events', { type: 'DICE_LEADERBOARD_UPDATED', tournamentId: tourneyIdInt, email });
    }
    return result;
  }

  async tournamentBuyRolls(email: string, tournamentId: any) {
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) throw new BadRequestException('Invalid details.');

    const result = await this.db.executeTransaction(async (tx: any) => {
      const tourney = await tx.get(`SELECT * FROM dice_tournaments WHERE id = ? AND status = 'ACTIVE'`, [tourneyIdInt]);
      if (!tourney) throw new Error('Tournament is no longer active.');
      if (tourney.ends_at && new Date(tourney.ends_at) < new Date()) {
        throw new Error('Tournament has already ended.');
      }

      const participant = await tx.get('SELECT * FROM dice_tournament_participants WHERE tournament_id = ? AND LOWER(email) = ?', [tourneyIdInt, email.toLowerCase()]);
      if (!participant) throw new Error('You are not registered in this tournament.');

      const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < tourney.entry_fee) throw new Error('Insufficient balance to buy rolls.');

      const balance = user.balance - tourney.entry_fee;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [balance, email.toLowerCase()]);

      const newPrizePool = tourney.prize_pool + tourney.entry_fee;
      await tx.run('UPDATE dice_tournaments SET prize_pool = ? WHERE id = ?', [newPrizePool, tourneyIdInt]);

      const newRolls = participant.rolls_left + 10;
      await tx.run(
        'UPDATE dice_tournament_participants SET rolls_left = ?, completed = 0 WHERE tournament_id = ? AND LOWER(email) = ?',
        [newRolls, tourneyIdInt, email.toLowerCase()]
      );

      const txId = this.generateTxId();
      await tx.run(
        `INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'DICE_TOURNEY_BUY_ROLLS', ?, ?, ?)`,
        [txId, email.toLowerCase(), -tourney.entry_fee, balance, new Date().toISOString()]
      );

      return { success: true, newBalance: balance, rollsLeft: newRolls };
    });

    this.gateway.server.emit('dice_events', { type: 'DICE_LEADERBOARD_UPDATED', tournamentId: tourneyIdInt, email });
    return result;
  }

  async tournamentLeaderboard(tournamentId: string) {
    const tourneyIdInt = parseInt(tournamentId, 10);
    if (isNaN(tourneyIdInt)) throw new BadRequestException('Invalid tournament ID.');

    return this.db.all(`
      SELECT p.email, p.total_score, p.rolls_left, p.completed, u.username
      FROM dice_tournament_participants p
      JOIN users u ON LOWER(p.email) = LOWER(u.email)
      WHERE p.tournament_id = ?
      ORDER BY p.total_score DESC, p.rolls_left ASC
    `, [tourneyIdInt]);
  }

  async getCrashActiveBets() {
    const game = await this.db.get('SELECT id FROM crash_games ORDER BY id DESC LIMIT 1');
    if (!game) return [];
    const bets = await this.db.all(`
      SELECT b.id, b.bet_amount, b.cashout_multiplier, b.winnings, b.status, u.username
      FROM crash_bets b
      JOIN users u ON LOWER(b.email) = LOWER(u.email)
      WHERE b.game_id = ?
    `, [game.id]);
    return bets.map((b: any) => ({
      id: b.id,
      username: b.username,
      betAmount: b.bet_amount,
      cashoutMultiplier: b.cashout_multiplier,
      winnings: b.winnings,
      status: b.status
    }));
  }

  async getCrashHistory(email: string) {
    if (!email) throw new BadRequestException('Email required');
    const history = await this.db.all(`
      SELECT b.id, b.bet_amount, b.cashout_multiplier, b.winnings, b.status, b.created_at, g.crash_point
      FROM crash_bets b
      JOIN crash_games g ON b.game_id = g.id
      WHERE LOWER(b.email) = ?
      ORDER BY b.id DESC LIMIT 50
    `, [email.toLowerCase()]);
    return history.map((b: any) => ({
      id: b.id,
      betAmount: b.bet_amount,
      cashoutMultiplier: b.cashout_multiplier,
      winnings: b.winnings,
      status: b.status,
      createdAt: b.created_at,
      crashPoint: b.crash_point
    }));
  }

  async crashBet(email: string, bet: any) {
    const betAmount = parseFloat(bet);
    if (!email || isNaN(betAmount) || betAmount <= 0) {
      throw new BadRequestException('Invalid bet details.');
    }

    return this.db.executeTransaction(async (tx: any) => {
      const user = await tx.get('SELECT balance, username FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      if (!user) throw new Error('User not found.');
      if (user.balance < betAmount) throw new Error('Insufficient wallet funds.');

      const game = await tx.get(`SELECT id FROM crash_games WHERE status = 'BETTING' ORDER BY id DESC LIMIT 1`);
      if (!game) throw new Error('No open lobby for betting right now.');

      const existingBets = await tx.get('SELECT COUNT(*) as count FROM crash_bets WHERE game_id = ? AND LOWER(email) = ?', [game.id, email.toLowerCase()]);
      if (existingBets.count >= 2) throw new Error('You can only place up to 2 bets per round.');

      const newBalance = user.balance - betAmount;
      await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBalance, email.toLowerCase()]);

      const betInsert = await tx.run(
        'INSERT INTO crash_bets (game_id, email, bet_amount, status, created_at) VALUES (?, ?, ?, ?, ?)',
        [game.id, email.toLowerCase(), betAmount, 'LOCKED', new Date().toISOString()]
      );

      const txId = this.generateTxId();
      await tx.run(
        `INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'CRASH_BET', ?, ?, ?)`,
        [txId, email.toLowerCase(), -betAmount, newBalance, new Date().toISOString()]
      );

      this.gateway.server.emit('crash_bet_placed', {
        id: betInsert.lastID,
        gameId: game.id,
        username: user.username,
        betAmount,
        cashoutMultiplier: null,
        winnings: null,
        status: 'LOCKED'
      });

      await this.routeWagerCommission(email, betAmount, 'CRASH', tx);
      await this.checkAndTriggerBounty(email, tx);

      return { newBalance, gameId: game.id, betId: betInsert.lastID };
    });
  }

  async crashCashout(email: string, betId: any) {
    if (!email || !betId) throw new BadRequestException('Email and betId required.');
    if (this.crashService.state !== 'FLIGHT') {
      throw new BadRequestException('Flight is not active or already crashed.');
    }

    const currentMultiplier = this.crashService.currentMultiplier;
    const gameId = this.crashService.gameId;

    return this.db.executeTransaction(async (tx: any) => {
      const bet = await tx.get(`SELECT * FROM crash_bets WHERE id = ? AND game_id = ? AND LOWER(email) = ? AND status = 'LOCKED'`, [betId, gameId, email.toLowerCase()]);
      if (!bet) throw new Error('No locked bet found for this round.');

      const payout = bet.bet_amount * currentMultiplier;
      await tx.run(`UPDATE crash_bets SET status = 'WON', cashout_multiplier = ?, winnings = ? WHERE id = ?`, [currentMultiplier, payout, bet.id]);
      
      const user = await tx.get('SELECT balance, totalWon, username FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
      const newBalance = user.balance + payout;
      const newTotalWon = (user.totalWon !== undefined ? parseFloat(user.totalWon) : (user.totalwon !== undefined ? parseFloat(user.totalwon) : 0))+ payout;

      await tx.run('UPDATE users SET balance = ?, totalWon = ? WHERE LOWER(email) = ?', [newBalance, newTotalWon, email.toLowerCase()]);

      const txId = this.generateTxId();
      await tx.run(
        `INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'CRASH_CASHOUT', ?, ?, ?)`,
        [txId, email.toLowerCase(), payout, newBalance, new Date().toISOString()]
      );

      this.gateway.server.emit('crash_cashed_out', {
        id: bet.id,
        gameId: gameId,
        username: user.username,
        betAmount: bet.bet_amount,
        cashoutMultiplier: currentMultiplier,
        winnings: payout,
        status: 'WON'
      });

      return { newBalance, payout, multiplier: currentMultiplier };
    });
  }

  async getAdminStats() {
    const totalUsers = await this.db.get('SELECT COUNT(*) as count FROM users');
    const totalWinnings = await this.db.get(`SELECT SUM(amount) as sum FROM transactions WHERE type = 'LOTTERY_WINOUT'`);
    const activeKillSwitch = await this.db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
    return {
      usersCount: totalUsers.count,
      totalPayouts: totalWinnings.sum || 0,
      killSwitchActive: activeKillSwitch ? activeKillSwitch.value === 'true' : false
    };
  }

  async toggleKillSwitch(active: boolean) {
    if (typeof active !== 'boolean') {
      throw new BadRequestException('State must be boolean active.');
    }
    const valueStr = active ? 'true' : 'false';
    await this.db.run(
      "INSERT OR REPLACE INTO game_settings (key, value) VALUES ('kill_switch_active', ?)",
      [valueStr]
    );
    await this.pubsub.publish({ type: 'KILL_SWITCH', active });
    return { killSwitchActive: active };
  }

  async verifyAudit(drawId: string) {
    const drawIdInt = parseInt(drawId, 10);
    if (isNaN(drawIdInt)) throw new BadRequestException('Invalid draw ID.');

    const audit = await this.db.get('SELECT * FROM audit_rng_logs WHERE drawId = ?', [drawIdInt]);
    if (!audit) throw new NotFoundException('RNG Audit trail not found for this draw ID.');

    const winningNumbers = JSON.parse(audit.winningNumbers);
    const isVerified = this.cryptoRng.verifyDrawNumbers(audit.seed, audit.salt, winningNumbers);

    return {
      drawId: drawIdInt,
      verified: isVerified,
      seed: audit.seed,
      salt: audit.salt,
      hash: audit.hash,
      winningNumbers,
      timestamp: audit.timestamp
    };
  }

  async checkAndTriggerBounty(email: string, tx: any) {
    try {
      const referral = await tx.get(
        `SELECT id, referrer_email, referee_email, status FROM referrals WHERE LOWER(referee_email) = ? AND status = 'PENDING'`,
        [email.toLowerCase()]
      );
      if (!referral) return;

      const configs = await tx.all('SELECT * FROM affiliate_config');
      const configMap: Record<string, string> = {};
      configs.forEach((c: any) => configMap[c.key] = c.value);

      const minDeposit = parseFloat(configMap.min_deposit_threshold) || 15;
      const minWager = parseFloat(configMap.min_wager_threshold) || 50;
      const referrerBounty = parseFloat(configMap.bounty_referrer_amount) || 10;
      const refereeBounty = 10.0;

      const depositSum = await tx.get(
        "SELECT SUM(amount) as total FROM transactions WHERE LOWER(email) = ? AND type = 'DEPOSIT'",
        [email.toLowerCase()]
      );
      const totalDeposits = depositSum ? parseFloat(depositSum.total || 0) : 0;

      const wagerSum = await tx.get(
        "SELECT ABS(SUM(amount)) as total FROM transactions WHERE LOWER(email) = ? AND type IN ('DICE_PLAY', 'SLOTS_PLAY', 'CRASH_PLAY', 'PLINKO_DROP', 'LOTTERY_PLAY')",
        [email.toLowerCase()]
      );
      const totalWagers = wagerSum ? parseFloat(wagerSum.total || 0) : 0;

      if (totalDeposits >= minDeposit || totalWagers >= minWager) {
        await tx.run(
          `UPDATE referrals SET status = 'BOUNTY_CLAIMED', bounty_claimed_at = ? WHERE id = ?`,
          [new Date().toISOString(), referral.id]
        );

        const referrerUser = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [referral.referrer_email.toLowerCase()]);
        if (referrerUser) {
          const newReferrerBalance = referrerUser.balance + referrerBounty;
          await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newReferrerBalance, referral.referrer_email.toLowerCase()]);

          const referrerTxId = this.generateTxId();
          await tx.run(
            `INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'REFERRAL_BOUNTY', ?, ?, ?)`,
            [referrerTxId, referral.referrer_email.toLowerCase(), referrerBounty, newReferrerBalance, new Date().toISOString()]
          );
        }

        const refereeUser = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
        if (refereeUser) {
          const newRefereeBalance = refereeUser.balance + refereeBounty;
          await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newRefereeBalance, email.toLowerCase()]);

          const refereeTxId = this.generateTxId();
          await tx.run(
            `INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'REFEREE_WELCOME_BONUS', ?, ?, ?)`,
            [refereeTxId, email.toLowerCase(), refereeBounty, newRefereeBalance, new Date().toISOString()]
          );
        }
        console.log(`[AFFILIATE ENGINE] Bounty qualified: ${email} -> ${referral.referrer_email}`);
      }
    } catch (err) {
      console.error('Error triggering bounty:', err);
    }
  }

  async routeWagerCommission(refereeEmail: string, wagerAmount: number, gameType: string, tx: any) {
    try {
      await this.pubsub.publish({
        type: 'WAGER_PROCESSED',
        email: refereeEmail.toLowerCase(),
        wagerAmount,
        gameType
      });

      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const recentBonus = await tx.get(
        "SELECT COUNT(*) as count FROM transactions WHERE LOWER(email) = ? AND type = 'RULE_BONUS_DISPATCH' AND timestamp >= ?",
        [refereeEmail.toLowerCase(), oneHourAgo]
      );

      if (recentBonus && parseInt(recentBonus.count || 0, 10) === 0) {
        const lossRow = await tx.get(
          "SELECT SUM(amount) as net FROM transactions WHERE LOWER(email) = ? AND timestamp >= ?",
          [refereeEmail.toLowerCase(), oneHourAgo]
        );
        const netLoss = lossRow && lossRow.net ? parseFloat(lossRow.net) : 0.0;

        if (netLoss < 0 && Math.abs(netLoss) >= 500) {
          const activeRule = await tx.get(
            "SELECT * FROM bonus_rules WHERE trigger_type = 'HOURLY_LOSS' AND active = 1 ORDER BY threshold DESC LIMIT 1"
          );
          if (activeRule && Math.abs(netLoss) >= activeRule.threshold) {
            const reward = JSON.parse(activeRule.bonus_reward);
            const user = await tx.get('SELECT balance FROM users WHERE LOWER(email) = ?', [refereeEmail.toLowerCase()]);
            if (user) {
              let bonusAmount = 0;
              if (reward.type === 'CASH') bonusAmount = parseFloat(reward.amount);
              else if (reward.type === 'FREE_DROPS') bonusAmount = parseFloat(reward.amount) * 1.5;

              const newBal = user.balance + bonusAmount;
              await tx.run('UPDATE users SET balance = ? WHERE LOWER(email) = ?', [newBal, refereeEmail.toLowerCase()]);

              const txId = this.generateTxId();
              await tx.run(
                "INSERT INTO transactions (id, email, type, amount, balanceAfter, timestamp) VALUES (?, ?, 'RULE_BONUS_DISPATCH', ?, ?, ?)",
                [txId, refereeEmail.toLowerCase(), bonusAmount, newBal, new Date().toISOString()]
              );
            }
          }
        }
      }

      const referral = await tx.get('SELECT referred_by FROM user_referral_codes WHERE LOWER(email) = ?', [refereeEmail.toLowerCase()]);
      if (!referral || !referral.referred_by) return;

      const referrerEmail = referral.referred_by;
      const configs = await tx.all('SELECT * FROM affiliate_config');
      const configMap: Record<string, string> = {};
      configs.forEach((c: any) => configMap[c.key] = c.value);

      const wagerCommissionEnabled = configMap.wager_commission_enabled === 'true';

      let houseEdge = 0.05;
      if (gameType === 'CRASH') {
        const crashHouseEdge = await tx.get("SELECT value FROM crash_config WHERE key = 'house_edge'");
        houseEdge = crashHouseEdge ? parseFloat(crashHouseEdge.value) : 0.01;
      } else if (gameType === 'DICE') {
        houseEdge = 0.023;
      } else if (gameType === 'SLOTS') {
        const slotsHouseEdge = await tx.get("SELECT value FROM slots_config WHERE key = 'target_rtp'");
        houseEdge = slotsHouseEdge ? (1.0 - parseFloat(slotsHouseEdge.value)) : 0.10;
      } else if (gameType === 'PLINKO') {
        const plinkoHouseEdge = await tx.get("SELECT value FROM plinko_config WHERE key = 'house_edge'");
        houseEdge = plinkoHouseEdge ? parseFloat(plinkoHouseEdge.value) : 0.05;
      }

      const referrerWallet = await tx.get('SELECT total_network_volume, commission_balance FROM user_affiliate_wallets WHERE LOWER(email) = ?', [referrerEmail.toLowerCase()]);
      if (!referrerWallet) return;

      let rankMultiplier = 0.05;
      const currentVol = referrerWallet.total_network_volume;

      const bronzeMult = parseFloat(configMap.rank_bronze_multiplier) || 0.05;
      const silverMult = parseFloat(configMap.rank_silver_multiplier) || 0.10;
      const goldMult = parseFloat(configMap.rank_gold_multiplier) || 0.15;
      const diamondMult = parseFloat(configMap.rank_diamond_multiplier) || 0.25;

      const silverVol = parseFloat(configMap.rank_silver_volume) || 1000;
      const goldVol = parseFloat(configMap.rank_gold_volume) || 10000;
      const diamondVol = parseFloat(configMap.rank_diamond_volume) || 100000;

      if (currentVol >= diamondVol) rankMultiplier = diamondMult;
      else if (currentVol >= goldVol) rankMultiplier = goldMult;
      else if (currentVol >= silverVol) rankMultiplier = silverMult;
      else rankMultiplier = bronzeMult;

      const potentialCommission = wagerAmount * houseEdge * rankMultiplier;

      if (!wagerCommissionEnabled) {
        await tx.run(
          'INSERT INTO shadow_commission_logs (referee_email, referrer_email, wager_amount, potential_commission, timestamp) VALUES (?, ?, ?, ?, ?)',
          [refereeEmail.toLowerCase(), referrerEmail.toLowerCase(), wagerAmount, potentialCommission, new Date().toISOString()]
        );
      } else {
        const newCommissionBalance = referrerWallet.commission_balance + potentialCommission;
        const newNetworkVolume = currentVol + wagerAmount;

        let nextRank = 'BRONZE';
        if (newNetworkVolume >= diamondVol) nextRank = 'DIAMOND';
        else if (newNetworkVolume >= goldVol) nextRank = 'GOLD';
        else if (newNetworkVolume >= silverVol) nextRank = 'SILVER';

        await tx.run(
          'UPDATE user_affiliate_wallets SET commission_balance = ?, total_network_volume = ?, current_rank = ? WHERE LOWER(email) = ?',
          [newCommissionBalance, newNetworkVolume, nextRank, referrerEmail.toLowerCase()]
        );
      }
    } catch (err) {
      console.error('Error routing commission:', err);
    }
  }

  // Proxies
  async proxyToBackoffice(req: Request, res: Response) {
    try {
      const backofficeUrl = process.env.BACKOFFICE_URL || 'http://127.0.0.1:5001';
      const proxyPath = req.originalUrl.replace(/^\/api\/v1\/admin/, '');
      const targetUrl = `${backofficeUrl}/api/v1/admin${proxyPath}`;
      const options: any = {
        method: req.method,
        headers: { 
          'Content-Type': 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
          ...(req.headers['x-csrf-token'] ? { 'x-csrf-token': String(req.headers['x-csrf-token']) } : {}),
          ...(req.requestId ? { 'x-request-id': req.requestId } : {}),
        }
      };
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        options.body = JSON.stringify(req.body);
      }
      const response = await fetch(targetUrl, options);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(502).json({ success: false, error: 'Back-office API Gateway Timeout' });
    }
  }

  async proxyToLoyalty(req: Request, res: Response) {
    try {
      const loyaltyUrl = process.env.LOYALTY_URL || 'http://127.0.0.1:5002';
      const proxyPath = req.originalUrl.replace(/^\/api\/v1\/loyalty/, '');
      const targetUrl = `${loyaltyUrl}/api/v1/loyalty${proxyPath}`;
      const options: any = {
        method: req.method,
        headers: { 
          'Content-Type': 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
          ...(req.headers['x-csrf-token'] ? { 'x-csrf-token': String(req.headers['x-csrf-token']) } : {}),
          ...(req.requestId ? { 'x-request-id': req.requestId } : {}),
        }
      };
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        options.body = JSON.stringify(req.body);
      }
      const response = await fetch(targetUrl, options);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(502).json({ success: false, error: 'Loyalty Engine Timeout' });
    }
  }
}
