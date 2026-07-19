import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@cyber-casino/shared';
import { LotteryController } from './lottery.controller';
import { LotteryService } from './lottery.service';
import { LotteryGateway } from './lottery.gateway';
import { CrashService } from './crash.service';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [SharedModule],
  controllers: [LotteryController],
  providers: [
    LotteryService,
    LotteryGateway,
    CrashService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
