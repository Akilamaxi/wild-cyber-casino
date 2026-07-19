import { Module } from '@nestjs/common';
import { SharedModule } from '@cyber-casino/shared';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [SharedModule],
  controllers: [AdminController],
  providers: [AdminService, EventsGateway],
})
export class AppModule {}
