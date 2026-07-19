import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from '@cyber-casino/shared';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',').map(value => value.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true, methods: ['GET'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  
  const port = process.env.PORT || 5002;

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Cyber Casino Loyalty Engine')
      .setDescription('Loyalty & Rewards API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addSecurityRequirements('bearer')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`[LOYALTY ENGINE] NestJS microservice listening on port ${port}`);
}
bootstrap().catch(error => {
  console.error('[LOYALTY ENGINE] Startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
