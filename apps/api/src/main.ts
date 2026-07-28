import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
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
  // Allowlist tĩnh từ env (prod rỗng → fallback domain chính thức).
  const staticAllow = corsOrigins.length > 0 ? corsOrigins : ['https://tubutree.com', 'https://app.tubutree.com'];
  if (isProd && corsOrigins.length === 0) {
    bootLogger.warn('CORS_ORIGINS chưa cấu hình ở production — fallback về domain chính thức.');
  }
  // Origin webview Zalo Mini App — LUÔN cho phép (backend này phục vụ Mini App Zalo, không
  // phụ thuộc env). Nếu thiếu → trình duyệt Zalo chặn MỌI response API: không load được sản phẩm,
  // không login, Ví/Cá nhân trắng (đúng lỗi gặp trên thiết bị). Bao gồm h5.zdn.vn, *.zadn.vn, zalo.me.
  const zaloOriginRe = /^https:\/\/([a-z0-9-]+\.)*(zdn\.vn|zadn\.vn|zalo\.me)$/i;
  const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    // Không có Origin (app native/WebView không gửi, health check, server-to-server, curl) → cho qua.
    if (!origin) return cb(null, true);
    if (zaloOriginRe.test(origin)) return cb(null, true);
    if (staticAllow.includes(origin)) return cb(null, true);
    if (!isProd) return cb(null, true); // dev: mở hết cho tiện test local
    return cb(null, false); // prod + origin lạ → chặn (không set Allow-Origin)
  };

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: { origin: corsOrigin, credentials: true },
  });

  // Trust proxy: ZaloPay/Nginx/Cloudflare phía trước → req.ip = IP proxy nếu KHÔNG set,
  // mọi request share 1 counter trong ThrottlerGuard → 60req/min cho toàn site, dễ DOS lẫn nhau.
  // Set trust proxy=1 để Express lấy IP thật từ X-Forwarded-For (1 hop = reverse proxy chuẩn).
  app.set('trust proxy', 1);
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));
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
