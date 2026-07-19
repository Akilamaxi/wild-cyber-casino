import { Module, Global } from '@nestjs/common';
import { DbService } from './db.service';
import { PubSubService } from './pubsub.service';
import { CryptoRngService } from './crypto-rng.service';

@Global()
@Module({
  providers: [DbService, PubSubService, CryptoRngService],
  exports: [DbService, PubSubService, CryptoRngService],
})
export class SharedModule {}
export { DbService, PubSubService, CryptoRngService };
