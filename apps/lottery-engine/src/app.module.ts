import { Module } from '@nestjs/common';
import { SharedModule } from '@cyber-casino/shared';
import { LotteryController } from './lottery.controller';
import { LotteryService } from './lottery.service';
import { LotteryGateway } from './lottery.gateway';
import { CrashService } from './crash.service';

@Module({
  imports: [SharedModule],
  controllers: [LotteryController],
  providers: [LotteryService, LotteryGateway, CrashService],
})
export class AppModule {}
