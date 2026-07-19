import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@cyber-casino/shared';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LotteryController } from './lottery.controller';
import { LotteryService } from './lottery.service';
import { LotteryGateway } from './lottery.gateway';
import { CrashService } from './crash.service';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60, limit: 100 }], // 100 requests per 60 seconds
      storage: new ThrottlerStorageRedisService(process.env.REDIS_URL || 'redis://127.0.0.1:6379'),
    }),
  ],
  controllers: [LotteryController],
  providers: [
    LotteryService,
    LotteryGateway,
    CrashService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
