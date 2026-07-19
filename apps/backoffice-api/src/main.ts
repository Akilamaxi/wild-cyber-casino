import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = (process.env.ADMIN_CORS_ORIGINS || 'http://localhost:5174')
    .split(',').map(value => value.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  
  const port = process.env.PORT || 5001;

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Cyber Casino Backoffice API')
      .setDescription('Admin management API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addSecurityRequirements('bearer')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`>>>> [BACKOFFICE GATEWAY] NestJS gateway running on port ${port}`);
}
bootstrap().catch(error => {
  console.error('[BACKOFFICE GATEWAY] Startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
