import { Controller, Post, Get, Req, Res, Body, Query, Param, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { LotteryService } from './lottery.service';

@Controller('api')
export class LotteryController {
  constructor(private readonly service: LotteryService) {}

  @Post('auth/login')
  async login(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
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
        mockGeo
      );
      return res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err.status || 400;
      return res.status(status).json({ success: false, error: err.message || 'Login failed' });
    }
  }

  @Post('auth/register')
  async register(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
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
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message || 'Registration failed' });
    }
  }

  @Get('leaderboard')
  async getLeaderboard(@Res() res: Response) {
    try {
      const leaderboard = await this.service.getLeaderboard();
      return res.json({ success: true, leaderboard });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('spin-wheel/prizes')
  async getSpinwheelPrizes(@Res() res: Response) {
    try {
      const prizes = await this.service.getSpinwheelPrizes();
      return res.json({ success: true, prizes });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('spin')
  async spin(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.spin(body.email);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Get('slots/config')
  async getSlotsConfig(@Res() res: Response) {
    try {
      const config = await this.service.getSlotsConfig();
      return res.json({ success: true, config });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('slots/spin')
  async slotsSpin(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.slotsSpin(body.email, body.bet);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Get('plinko/history')
  async getPlinkoHistory(@Query('email') email: string, @Res() res: Response) {
    try {
      const history = await this.service.getPlinkoHistory(email);
      return res.json({ success: true, history });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('plinko/drop')
  async plinkoDrop(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      await this.service.authenticateRequest(req);
      const result = await this.service.plinkoDrop(body);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err.status || 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  @Get('user/wallet')
  async getWallet(@Req() req: Request, @Res() res: Response) {
    try {
      const decoded = await this.service.authenticateRequest(req);
      const result = await this.service.getWallet(decoded.email);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err.status || 401;
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  @Post('user/wallet-address')
  async setWalletAddress(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const decoded = await this.service.authenticateRequest(req);
      await this.service.setWalletAddress(decoded.email, body.walletAddress);
      return res.json({ success: true });
    } catch (err: any) {
      const status = err.status || 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  @Post('user/deposit')
  async deposit(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.deposit(body.email, body.amount);
      return res.json({ success: true, newBalance: result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Post('user/withdraw')
  async withdraw(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.withdraw(body.email, body.amount);
      return res.json({ success: true, newBalance: result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Get('lottery/games')
  async getLotteryGames(@Res() res: Response) {
    try {
      const games = await this.service.getLotteryGames();
      return res.json({ success: true, games });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('lottery/status')
  async getLotteryStatus(@Query('email') email: string, @Query('lotteryName') lotteryName: string, @Res() res: Response) {
    try {
      const result = await this.service.getLotteryStatus(email, lotteryName);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('lottery/history')
  async getLotteryHistory(@Query('email') email: string, @Res() res: Response) {
    try {
      const result = await this.service.getLotteryHistory(email);
      return res.json({ success: true, tickets: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('lottery/winners/:gameName')
  async getLotteryWinners(@Param('gameName') gameName: string, @Res() res: Response) {
    try {
      const draws = await this.service.getLotteryWinners(gameName);
      return res.json({ success: true, draws });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('lottery/pool-tickets')
  async getLotteryPoolTickets(@Query('email') email: string, @Query('lotteryName') lotteryName: string, @Res() res: Response) {
    try {
      const tickets = await this.service.getLotteryPoolTickets(email, lotteryName);
      return res.json({ success: true, tickets });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('lottery/reserve')
  async reserveTickets(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.reserveTickets(body.email, body.ticketId, body.ticketIds);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Post('lottery/release')
  async releaseTickets(@Body() body: any, @Res() res: Response) {
    try {
      await this.service.releaseTickets(body.email, body.ticketId, body.ticketIds);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('lottery/checkout')
  async checkoutTickets(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.checkoutTickets(body.email, body.ticketId, body.ticketIds);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Get('dice/config')
  async getDiceConfig(@Res() res: Response) {
    try {
      const config = await this.service.getDiceConfig();
      return res.json({ success: true, config });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('dice/roll-single')
  async rollSingle(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.rollSingle(body.email, body.bet, body.prediction);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Get('dice/tournaments')
  async getDiceTournaments(@Res() res: Response) {
    try {
      const tournaments = await this.service.getDiceTournaments();
      return res.json({ success: true, tournaments });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('dice/tournament/join')
  async joinTournament(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const decoded = await this.service.authenticateRequest(req);
      const result = await this.service.joinTournament(decoded.email, body.tournamentId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err.status || 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  @Post('dice/tournament/roll')
  async tournamentRoll(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const decoded = await this.service.authenticateRequest(req);
      const result = await this.service.tournamentRoll(decoded.email, body.tournamentId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err.status || 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  @Post('dice/tournament/buy-rolls')
  async tournamentBuyRolls(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const decoded = await this.service.authenticateRequest(req);
      const result = await this.service.tournamentBuyRolls(decoded.email, body.tournamentId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err.status || 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  @Get('dice/tournament/leaderboard/:tournamentId')
  async tournamentLeaderboard(@Param('tournamentId') tournamentId: string, @Res() res: Response) {
    try {
      const leaderboard = await this.service.tournamentLeaderboard(tournamentId);
      return res.json({ success: true, leaderboard });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('crash/active-bets')
  async getCrashActiveBets(@Res() res: Response) {
    try {
      const bets = await this.service.getCrashActiveBets();
      return res.json({ success: true, bets });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('crash/history')
  async getCrashHistory(@Query('email') email: string, @Res() res: Response) {
    try {
      const history = await this.service.getCrashHistory(email);
      return res.json({ success: true, history });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('crash/bet')
  async crashBet(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.crashBet(body.email, body.bet);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Post('crash/cashout')
  async crashCashout(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.crashCashout(body.email, body.betId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  @Get('admin/stats')
  async getAdminStats(@Res() res: Response) {
    try {
      const stats = await this.service.getAdminStats();
      return res.json({ success: true, stats });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Post('admin/kill-switch')
  async toggleKillSwitch(@Body() body: any, @Res() res: Response) {
    try {
      const result = await this.service.toggleKillSwitch(body.active);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  @Get('admin/audit-verify/:drawId')
  async verifyAudit(@Param('drawId') drawId: string, @Res() res: Response) {
    try {
      const result = await this.service.verifyAudit(drawId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // Reverse Proxies
  @Post('admin/*')
  async proxyAdminPost(@Req() req: Request, @Res() res: Response) {
    return this.service.proxyToBackoffice(req, res);
  }
  @Get('admin/*')
  async proxyAdminGet(@Req() req: Request, @Res() res: Response) {
    return this.service.proxyToBackoffice(req, res);
  }
  @Post('loyalty/*')
  async proxyLoyaltyPost(@Req() req: Request, @Res() res: Response) {
    return this.service.proxyToLoyalty(req, res);
  }
  @Get('loyalty/*')
  async proxyLoyaltyGet(@Req() req: Request, @Res() res: Response) {
    return this.service.proxyToLoyalty(req, res);
  }
}
