import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from '@cyber-casino/shared';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',').map(value => value.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());

  // Docker places both compiled SPAs under dist/public. Express serves index.html
  // for / and /admin/ while API and WebSocket routes remain handled by Nest.
  app.useStaticAssets(join(__dirname, 'public'));
  
  const port = process.env.PORT || 8080;

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Cyber Casino Lottery Engine API')
      .setDescription('API documentation for the core game server')
      .setVersion('1.0')
      .addBearerAuth()
      .addSecurityRequirements('bearer')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`>>>> [LOTTERY ENGINE] NestJS server running on port ${port}`);
}
bootstrap().catch(error => {
  console.error('[LOTTERY ENGINE] Startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
