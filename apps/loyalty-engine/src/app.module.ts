import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@cyber-casino/shared';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyAuthGuard } from './loyalty-auth.guard';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60, limit: 100 }], // 100 requests per 60 seconds
      storage: new ThrottlerStorageRedisService(process.env.REDIS_URL || 'redis://127.0.0.1:6379'),
    }),
  ],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, { provide: APP_GUARD, useClass: LoyaltyAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },],
})
export class AppModule {}
