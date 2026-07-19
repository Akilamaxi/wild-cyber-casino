import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  
  const port = process.env.PORT || 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`>>>> [LOTTERY ENGINE] NestJS server running on port ${port}`);
}
bootstrap();
