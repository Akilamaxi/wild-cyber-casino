import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@cyber-casino/shared';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EventsGateway } from './events.gateway';
import { AdminAuthGuard } from './admin-auth.guard';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60, limit: 200 }], // 200 requests per 60 seconds
      storage: new ThrottlerStorageRedisService(process.env.REDIS_URL || 'redis://127.0.0.1:6379'),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, EventsGateway,    { provide: APP_GUARD, useClass: AdminAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },],
})
export class AppModule {}
