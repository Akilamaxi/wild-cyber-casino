import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@cyber-casino/shared';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyAuthGuard } from './loyalty-auth.guard';

@Module({
  imports: [SharedModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, { provide: APP_GUARD, useClass: LoyaltyAuthGuard }],
})
export class AppModule {}
