import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.use(helmet());
  // Log mọi request (chẩn đoán: xác nhận request từ Zalo Mini App có tới API không).
  const httpLog = new Logger('HTTP');
  app.use((req: { method: string; originalUrl?: string; url?: string }, _res: unknown, next: () => void) => {
    httpLog.log(`${req.method} ${req.originalUrl ?? req.url}`);
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Tubu Tree API')
    .setDescription('REST API cho Zalo Mini App + Web Shop')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`🌿 Tubu Tree API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
