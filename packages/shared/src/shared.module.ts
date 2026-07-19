import { Module, Global } from '@nestjs/common';
import { DbService } from './db.service';
import { PubSubService } from './pubsub.service';
import { CryptoRngService } from './crypto-rng.service';
import { SecurityMiddleware } from './security.middleware';
import { CsrfGuard } from './csrf.guard';

@Global()
@Module({
  providers: [DbService, PubSubService, CryptoRngService, SecurityMiddleware, CsrfGuard],
  exports: [DbService, PubSubService, CryptoRngService, SecurityMiddleware, CsrfGuard],
})
export class SharedModule {}
export { DbService, PubSubService, CryptoRngService };
