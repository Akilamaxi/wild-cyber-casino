import { Controller, Get, Query, BadRequestException, OnModuleInit } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';

@Controller('api/loyalty')
export class LoyaltyController implements OnModuleInit {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  async onModuleInit() {
    await this.loyaltyService.init();
  }

  @Get('status')
  async getStatus(@Query('email') email: string) {
    if (!email) {
      throw new BadRequestException('Email parameter missing');
    }
    const profile = await this.loyaltyService.getProfile(email);
    return { success: true, profile };
  }
}
