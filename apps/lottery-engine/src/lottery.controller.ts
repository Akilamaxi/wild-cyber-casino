import { All, Controller, Post, Get, Req, Res, Body, Query, Param } from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { LotteryService } from './lottery.service';
import { Public, Roles } from './security.decorators';
import { LoginDto, RegisterDto, WalletAddressDto, AmountDto, PaymentWebhookDto, SpinDto, BetDto, PlinkoDropDto, DiceRollDto, ReserveTicketDto, CrashCashoutDto, TournamentActionDto, BooleanStateDto } from '@cyber-casino/shared';

@Controller('api/v1')
export class LotteryController {
  constructor(private readonly service: LotteryService) {}

  @Post('auth/login')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    let mockGeo: any = null;
    if (req.headers['x-mock-ip-country']) {
      mockGeo = {
        country: req.headers['x-mock-ip-country'] as string,
        city: (req.headers['x-mock-ip-city'] as string) || 'Unknown',
        lat: parseFloat(req.headers['x-mock-ip-lat'] as string),
        lon: parseFloat(req.headers['x-mock-ip-lon'] as string),
      };
    }

    const result = await this.service.login(
      body.email,
      body.password,
      body.deviceFingerprint,
      ip as string,
      userAgent,
      mockGeo,
      body.mfaCode,
    );
    this.setSessionCookies(res, result.token, result.refreshToken);
    return { success: true, user: result.user, token: result.token };
  }

  @Post('auth/register')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async register(@Body() body: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    let mockGeo: any = null;
    if (req.headers['x-mock-ip-country']) {
      mockGeo = {
        country: req.headers['x-mock-ip-country'] as string,
        city: (req.headers['x-mock-ip-city'] as string) || 'Unknown',
        lat: parseFloat(req.headers['x-mock-ip-lat'] as string),
        lon: parseFloat(req.headers['x-mock-ip-lon'] as string),
      };
    }

    const result = await this.service.register(body, ip as string, userAgent, mockGeo);
    this.setSessionCookies(res, result.token, result.refreshToken);
    return { success: true, user: result.user, token: result.token };
  }

  @Post('auth/refresh')
  @Public()
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.refreshSession(req.cookies?.casino_refresh || '');
    this.setSessionCookies(res, result.token, result.refreshToken);
    return { success: true, user: result.user };
  }

  @Post('auth/logout')
  @Public()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.service.revokeRefreshSession(req.cookies?.casino_refresh || '');
    for (const name of ['casino_access', 'casino_refresh', 'casino_csrf']) {
      res.clearCookie(name, { path: '/' });
    }
    return { success: true };
  }

  private setSessionCookies(res: Response, access: string, refresh: string) {
    const secure = process.env.NODE_ENV === 'production';
    const common = { secure, sameSite: 'strict' as const, path: '/' };
    res.cookie('casino_access', access, { ...common, httpOnly: true, maxAge: 15 * 60 * 1000 });
    res.cookie('casino_refresh', refresh, { ...common, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.cookie('casino_csrf', crypto.randomBytes(24).toString('base64url'), { ...common, httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000 });
  }

  @Get('leaderboard')
  @Public()
  async getLeaderboard() {
    const leaderboard = await this.service.getLeaderboard();
    return { success: true, leaderboard };
  }

  @Get('spin-wheel/prizes')
  @Public()
  async getSpinwheelPrizes() {
    const prizes = await this.service.getSpinwheelPrizes();
    return { success: true, prizes };
  }

  @Post('spin')
  async spin(@Body() body: SpinDto) {
    const result = await this.service.spin(body.email);
    return { success: true, ...result };
  }

  @Get('slots/config')
  @Public()
  async getSlotsConfig() {
    const config = await this.service.getSlotsConfig();
    return { success: true, config };
  }

  @Post('slots/spin')
  async slotsSpin(@Body() body: BetDto) {
    const result = await this.service.slotsSpin(body.email, body.bet);
    return { success: true, ...result };
  }

  @Get('plinko/history')
  async getPlinkoHistory(@Query('email') email: string) {
    const history = await this.service.getPlinkoHistory(email);
    return { success: true, history };
  }

  @Post('plinko/drop')
  async plinkoDrop(@Body() body: PlinkoDropDto, @Req() req: Request) {
    await this.service.authenticateRequest(req);
    const result = await this.service.plinkoDrop(body);
    return { success: true, ...result };
  }

  @Get('user/wallet')
  async getWallet(@Req() req: Request) {
    const decoded = await this.service.authenticateRequest(req);
    const result = await this.service.getWallet(decoded.email);
    return { success: true, ...result };
  }

  @Post('user/wallet-address')
  async setWalletAddress(@Body() body: WalletAddressDto, @Req() req: Request) {
    const decoded = await this.service.authenticateRequest(req);
    await this.service.setWalletAddress(decoded.email, body.walletAddress);
    return { success: true };
  }

  @Post('user/deposit')
  async deposit(@Body() body: AmountDto) {
    const result = await this.service.deposit(body.email, body.amount);
    return { success: true, newBalance: result };
  }

  @Post('payments/webhook')
  @Public()
  async paymentWebhook(@Body() body: PaymentWebhookDto, @Req() req: Request) {
    const result = await this.service.processPaymentWebhook(body, {
      signature: String(req.headers['x-payment-signature'] || ''),
      timestamp: String(req.headers['x-payment-timestamp'] || ''),
      nonce: String(req.headers['x-payment-nonce'] || ''),
    });
    return { success: true, ...result };
  }

  @Post('user/withdraw')
  async withdraw(@Body() body: AmountDto) {
    const result = await this.service.withdraw(body.email, body.amount);
    return { success: true, newBalance: result };
  }

  @Get('lottery/games')
  @Public()
  async getLotteryGames() {
    const games = await this.service.getLotteryGames();
    return { success: true, games };
  }

  @Get('lottery/status')
  async getLotteryStatus(@Query('email') email: string, @Query('lotteryName') lotteryName: string) {
    const result = await this.service.getLotteryStatus(email, lotteryName);
    return { success: true, ...result };
  }

  @Get('lottery/history')
  async getLotteryHistory(@Query('email') email: string) {
    const result = await this.service.getLotteryHistory(email);
    return { success: true, tickets: result };
  }

  @Get('lottery/winners/:gameName')
  @Public()
  async getLotteryWinners(@Param('gameName') gameName: string) {
    const draws = await this.service.getLotteryWinners(gameName);
    return { success: true, draws };
  }

  @Get('lottery/pool-tickets')
  async getLotteryPoolTickets(@Query('email') email: string, @Query('lotteryName') lotteryName: string) {
    const tickets = await this.service.getLotteryPoolTickets(email, lotteryName);
    return { success: true, tickets };
  }

  @Post('lottery/reserve')
  async reserveTickets(@Body() body: ReserveTicketDto) {
    const result = await this.service.reserveTickets(body.email, body.ticketId, body.ticketIds);
    return { success: true, ...result };
  }

  @Post('lottery/release')
  async releaseTickets(@Body() body: ReserveTicketDto) {
    await this.service.releaseTickets(body.email, body.ticketId, body.ticketIds);
    return { success: true };
  }

  @Post('lottery/checkout')
  async checkoutTickets(@Body() body: ReserveTicketDto) {
    const result = await this.service.checkoutTickets(body.email, body.ticketId, body.ticketIds);
    return { success: true, ...result };
  }

  @Get('dice/config')
  @Public()
  async getDiceConfig() {
    const config = await this.service.getDiceConfig();
    return { success: true, config };
  }

  @Post('dice/roll-single')
  async rollSingle(@Body() body: DiceRollDto) {
    const result = await this.service.rollSingle(body.email, body.bet, body.prediction);
    return { success: true, ...result };
  }

  @Get('dice/tournaments')
  @Public()
  async getDiceTournaments() {
    const tournaments = await this.service.getDiceTournaments();
    return { success: true, tournaments };
  }

  @Post('dice/tournament/join')
  async joinTournament(@Body() body: TournamentActionDto, @Req() req: Request) {
    const decoded = await this.service.authenticateRequest(req);
    const result = await this.service.joinTournament(decoded.email, body.tournamentId);
    return { success: true, ...result };
  }

  @Post('dice/tournament/roll')
  async tournamentRoll(@Body() body: TournamentActionDto, @Req() req: Request) {
    const decoded = await this.service.authenticateRequest(req);
    const result = await this.service.tournamentRoll(decoded.email, body.tournamentId);
    return { success: true, ...result };
  }

  @Post('dice/tournament/buy-rolls')
  async tournamentBuyRolls(@Body() body: TournamentActionDto, @Req() req: Request) {
    const decoded = await this.service.authenticateRequest(req);
    const result = await this.service.tournamentBuyRolls(decoded.email, body.tournamentId);
    return { success: true, ...result };
  }

  @Get('dice/tournament/leaderboard/:tournamentId')
  @Public()
  async tournamentLeaderboard(@Param('tournamentId') tournamentId: string) {
    const leaderboard = await this.service.tournamentLeaderboard(tournamentId);
    return { success: true, leaderboard };
  }

  @Get('crash/active-bets')
  async getCrashActiveBets() {
    const bets = await this.service.getCrashActiveBets();
    return { success: true, bets };
  }

  @Get('crash/history')
  async getCrashHistory(@Query('email') email: string) {
    const history = await this.service.getCrashHistory(email);
    return { success: true, history };
  }

  @Post('crash/bet')
  async crashBet(@Body() body: BetDto) {
    const result = await this.service.crashBet(body.email, body.bet);
    return { success: true, ...result };
  }

  @Post('crash/cashout')
  async crashCashout(@Body() body: CrashCashoutDto) {
    const result = await this.service.crashCashout(body.email, body.betId);
    return { success: true, ...result };
  }

  @Get('admin/stats')
  @Roles('ADMIN')
  async getAdminStats() {
    const stats = await this.service.getAdminStats();
    return { success: true, stats };
  }

  @Post('admin/kill-switch')
  @Roles('ADMIN')
  async toggleKillSwitch(@Body() body: BooleanStateDto) {
    const result = await this.service.toggleKillSwitch(body.active);
    return { success: true, ...result };
  }

  @Get('admin/audit-verify/:drawId')
  @Roles('ADMIN')
  async verifyAudit(@Param('drawId') drawId: string) {
    const result = await this.service.verifyAudit(drawId);
    return { success: true, ...result };
  }

  // Reverse Proxies
  @All('admin/*path')
  @Roles('ADMIN')
  async proxyAdmin(@Req() req: Request, @Res() res: Response) {
    return this.service.proxyToBackoffice(req, res);
  }
  @All('loyalty/*path')
  async proxyLoyalty(@Req() req: Request, @Res() res: Response) {
    return this.service.proxyToLoyalty(req, res);
  }
}
