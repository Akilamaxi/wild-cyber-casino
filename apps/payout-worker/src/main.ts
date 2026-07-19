import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // payout-worker is a background daemon, we don't need to listen on a port.
  const app = await NestFactory.createApplicationContext(AppModule);
  console.log('[PAYOUT WORKER / SCHEDULER] NestJS application context initialized successfully.');
}
bootstrap();
