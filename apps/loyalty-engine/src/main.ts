import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  
  const port = process.env.PORT || 5002;
  await app.listen(port, '0.0.0.0');
  console.log(`[LOYALTY ENGINE] NestJS microservice listening on port ${port}`);
}
bootstrap();
