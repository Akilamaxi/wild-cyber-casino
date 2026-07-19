import { SharedModule, DbService, PubSubService, CryptoRngService } from './src/shared.module';

// Instantiate singletons for legacy JS microservices mapping
const db = new DbService();
const pubsub = new PubSubService();
const cryptoRng = new CryptoRngService();

export { SharedModule, DbService, PubSubService, CryptoRngService, db, pubsub, cryptoRng };
