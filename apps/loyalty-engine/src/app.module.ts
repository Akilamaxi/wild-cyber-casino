import { Module } from '@nestjs/common';
import { SharedModule } from '@cyber-casino/shared';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  imports: [SharedModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
})
export class AppModule {}
