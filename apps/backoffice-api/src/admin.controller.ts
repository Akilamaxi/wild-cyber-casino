import { Controller, Get, Post, Put, Delete, Body, Param, Query, BadRequestException, OnModuleInit } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('api/admin')
export class AdminController implements OnModuleInit {
  constructor(private readonly adminService: AdminService) {}

  async onModuleInit() {
    await this.adminService.init();
  }

  @Post('kill-switch')
  async toggleKillSwitch(@Body('active') active: boolean) {
    if (typeof active !== 'boolean') {
      throw new BadRequestException('State must be boolean active.');
    }
    return this.adminService.toggleKillSwitch(active);
  }

  @Get('games')
  async getGames() {
    return this.adminService.getGames();
  }

  @Post('games')
  async createGame(@Body() body: any) {
    return this.adminService.createGame(body);
  }

  @Put('games/:id')
  async updateGame(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateGame(id, body);
  }

  @Get('spinwheel-prizes')
  async getSpinwheelPrizes() {
    return this.adminService.getSpinwheelPrizes();
  }

  @Post('spinwheel-prizes')
  async createSpinwheelPrize(@Body() body: any) {
    return this.adminService.createSpinwheelPrize(body);
  }

  @Put('spinwheel-prizes/:id')
  async updateSpinwheelPrize(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateSpinwheelPrize(id, body);
  }

  @Delete('spinwheel-prizes/:id')
  async deleteSpinwheelPrize(@Param('id') id: string) {
    return this.adminService.deleteSpinwheelPrize(id);
  }

  @Post('spinwheel-prizes/reorder')
  async reorderSpinwheelPrizes(@Body('orderedIds') orderedIds: string[]) {
    if (!Array.isArray(orderedIds)) {
      throw new BadRequestException('Invalid payload: orderedIds array required.');
    }
    return this.adminService.reorderSpinwheelPrizes(orderedIds);
  }

  @Get('slots/config')
  async getSlotsConfig() {
    return this.adminService.getSlotsConfig();
  }

  @Put('slots/config')
  async updateSlotsConfig(@Body() body: any) {
    return this.adminService.updateSlotsConfig(body);
  }

  @Get('dice/config')
  async getDiceConfig() {
    return this.adminService.getDiceConfig();
  }

  @Put('dice/config')
  async updateDiceConfig(@Body() body: any) {
    return this.adminService.updateDiceConfig(body);
  }

  @Post('dice/tournaments')
  async createDiceTournament(@Body() body: any) {
    return this.adminService.createDiceTournament(body);
  }

  @Post('dice/tournaments/:id/complete')
  async completeDiceTournament(@Param('id') id: string, @Body('adminEmail') adminEmail: string) {
    return this.adminService.completeDiceTournament(id, adminEmail);
  }

  @Get('crash/config')
  async getCrashConfig() {
    return this.adminService.getCrashConfig();
  }

  @Put('crash/config')
  async updateCrashConfig(@Body() body: any) {
    return this.adminService.updateCrashConfig(body);
  }

  @Get('plinko/config')
  async getPlinkoConfig() {
    return this.adminService.getPlinkoConfig();
  }

  @Put('plinko/config')
  async updatePlinkoConfig(@Body() body: any) {
    return this.adminService.updatePlinkoConfig(body);
  }

  @Get('affiliate/config')
  async getAffiliateConfig() {
    return this.adminService.getAffiliateConfig();
  }

  @Put('affiliate/config')
  async updateAffiliateConfig(@Body() body: any) {
    return this.adminService.updateAffiliateConfig(body);
  }

  @Get('affiliate/shadow-logs')
  async getAffiliateShadowLogs() {
    return this.adminService.getAffiliateShadowLogs();
  }

  @Get('audit-verify/:drawId')
  async verifyAudit(@Param('drawId') drawId: string) {
    return this.adminService.verifyAudit(drawId);
  }

  @Get('security/alerts')
  async getSecurityAlerts() {
    return this.adminService.getSecurityAlerts();
  }

  @Post('security/alerts/:id/resolve')
  async resolveSecurityAlert(@Param('id') id: string, @Body('adminEmail') adminEmail: string) {
    return this.adminService.resolveSecurityAlert(id, adminEmail);
  }

  @Post('users/:email/status')
  async updateUserStatus(@Param('email') email: string, @Body() body: any) {
    return this.adminService.updateUserStatus(email, body.status, body.adminEmail);
  }

  @Get('users/:email/tags')
  async getUserTags(@Param('email') email: string) {
    return this.adminService.getUserTags(email);
  }

  @Post('users/:email/tags')
  async updateUserTags(@Param('email') email: string, @Body() body: any) {
    return this.adminService.updateUserTags(email, body.tags, body.adminEmail);
  }

  @Get('bonus-rules')
  async getBonusRules() {
    return this.adminService.getBonusRules();
  }

  @Post('bonus-rules')
  async createBonusRule(@Body() body: any) {
    return this.adminService.createBonusRule(body);
  }

  @Post('bonus-rules/:id/toggle')
  async toggleBonusRule(@Param('id') id: string, @Body() body: any) {
    return this.adminService.toggleBonusRule(id, body.active, body.adminEmail);
  }

  @Get('users/:email/360-view')
  async getUser360View(@Param('email') email: string) {
    return this.adminService.getUser360View(email);
  }

  @Get('game-logs')
  async getGameLogs() {
    return this.adminService.getGameLogs();
  }

  @Get('affiliate/stats')
  async getAffiliateStats() {
    return this.adminService.getAffiliateStats();
  }

  @Get('audit-logs')
  async getAuditLogs() {
    return this.adminService.getAuditLogs();
  }
}
