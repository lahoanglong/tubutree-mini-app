import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const bootLogger = new Logger('Bootstrap');

  // CORS allowlist: đọc từ env CORS_ORIGINS (CSV). Dev rỗng → mở; prod rỗng → fallback domain chính.
  // Env validation (env.validation.ts) fail-fast nếu prod thiếu CORS_ORIGINS — fallback chỉ
  // chạy khi schema đã được nới lỏng, vẫn warn để ops thấy.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  let corsOrigin: boolean | string[];
  if (corsOrigins.length > 0) {
    corsOrigin = corsOrigins;
  } else if (!isProd) {
    corsOrigin = true;
  } else {
    // Dùng instance logger — Logger static có thể no-op trước khi NestFactory.create init
    // → ops sẽ KHÔNG thấy warning fallback nếu dùng `Logger.warn` static.
    bootLogger.warn('CORS_ORIGINS chưa cấu hình ở production — fallback về domain chính thức.');
    corsOrigin = ['https://tubutree.com', 'https://app.tubutree.com'];
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: { origin: corsOrigin, credentials: true },
  });

  // Trust proxy: ZaloPay/Nginx/Cloudflare phía trước → req.ip = IP proxy nếu KHÔNG set,
  // mọi request share 1 counter trong ThrottlerGuard → 60req/min cho toàn site, dễ DOS lẫn nhau.
  // Set trust proxy=1 để Express lấy IP thật từ X-Forwarded-For (1 hop = reverse proxy chuẩn).
  if (isProd) app.set('trust proxy', 1);

  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Map Prisma errors → HTTP status nhất quán (tránh 500 trần khi P2025/P2002/...).
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Swagger chỉ bật ở non-production để tránh lộ schema/endpoint nội bộ.
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tubu Tree API')
      .setDescription('REST API cho Zalo Mini App + Web Shop')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`🌿 Tubu Tree API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
