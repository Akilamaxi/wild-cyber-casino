import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@cyber-casino/shared';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EventsGateway } from './events.gateway';
import { AdminAuthGuard } from './admin-auth.guard';

@Module({
  imports: [SharedModule],
  controllers: [AdminController],
  providers: [AdminService, EventsGateway, { provide: APP_GUARD, useClass: AdminAuthGuard }],
})
export class AppModule {}
