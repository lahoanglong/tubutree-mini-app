import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, type NestApplicationOptions, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
// Import trực tiếp — không phải qua @nestjs/platform-express — nên PHẢI là dependency trực
// tiếp của package này (đã thêm ở package.json). Trước đây chỉ resolve được nhờ hoist tình cờ
// khi cài đặt TOÀN BỘ monorepo (dev/CI); Docker build chỉ copy apps/api + packages nên hoist
// khác đi, và `require('express')` vỡ ở runtime với "Cannot find module 'express'".
import { json, urlencoded } from 'express';
import { CronLeaderService } from './common/cron-leader/cron-leader.service';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { createValidationPipe } from './common/validation-pipe';
import { applyHttpTimeouts } from './config/http-timeouts';

/** Dọn app khởi động hỏng tối đa chừng này rồi vẫn thoát — đóng hàng đợi/Redis treo không được giữ process lại. */
const FAILED_BOOT_CLOSE_MS = 5_000;

export interface BootstrapOptions {
  port: number;
  /** Mặc định process.exit — test truyền hàm giả để đo mã thoát. */
  exit?: (code: number) => void;
  logger?: NestApplicationOptions['logger'];
}

/**
 * Dựng và mở cổng API. Hỏng ở bất kỳ bước nào (DB lúc khởi tạo module, cổng đã có process khác giữ — EADDRINUSE, quyền mở cổng…)
 * thì dọn app rồi thoát mã 1 để orchestrator khởi động lại: process "nửa sống" không phục vụ HTTP nhưng vẫn giữ cron chạy ngoài
 * lease leader là gửi cảnh báo, đối soát ZaloPay và đồng bộ danh mục trùng với leader (R5-SYNC-2). Trả app khi đã mở cổng.
 */
export async function bootstrap(rootModule: Type<unknown>, opts: BootstrapOptions): Promise<NestExpressApplication | undefined> {
  const bootLogger = new Logger('Bootstrap');
  let app: NestExpressApplication | undefined;
  try {
    app = await createApp(rootModule, opts);
    applyHttpTimeouts(app.getHttpServer());
    await app.listen(opts.port, '0.0.0.0');
    // Cron chỉ chạy từ đây, khi instance này giữ được lease (CronLeaderService dừng mọi job lúc ScheduleModule đăng ký).
    app.get(CronLeaderService).start();
    Logger.log(`🌿 Tubu Tree API listening on http://localhost:${opts.port}/api`, 'Bootstrap');
    return app;
  } catch (err) {
    bootLogger.error(
      `Không khởi động được API (cổng ${opts.port}) — thoát mã 1: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    await closeWithin(app, FAILED_BOOT_CLOSE_MS, bootLogger);
    (opts.exit ?? ((code: number) => process.exit(code)))(1);
    return undefined;
  }
}

async function closeWithin(app: NestExpressApplication | undefined, ms: number, logger: Logger): Promise<void> {
  if (!app) return;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`Dọn app khởi động hỏng quá ${ms} ms — thoát luôn.`);
      resolve();
    }, ms);
    timer.unref();
  });
  try {
    await Promise.race([
      app.close().catch((e: unknown) => logger.warn(`Dọn app khởi động hỏng lỗi: ${e instanceof Error ? e.message : String(e)}`)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createApp(rootModule: Type<unknown>, opts: BootstrapOptions): Promise<NestExpressApplication> {
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
  // Cho phép domain chính và TẤT CẢ subdomain đối tác (*.tubutree.com) phục vụ Multi-tenancy Storefront.
  const tubuOriginRe = /^https?:\/\/([a-z0-9-]+\.)*tubutree\.com(:[0-9]+)?$/i;
  const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    // Không có Origin (app native/WebView không gửi, health check, server-to-server, curl) → cho qua.
    if (!origin) return cb(null, true);
    if (zaloOriginRe.test(origin)) return cb(null, true);
    if (tubuOriginRe.test(origin)) return cb(null, true);
    if (staticAllow.includes(origin)) return cb(null, true);
    if (!isProd) return cb(null, true); // dev: mở hết cho tiện test local
    return cb(null, false); // prod + origin lạ → chặn (không set Allow-Origin)
  };

  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    // Retry-After không thuộc nhóm header CORS-safelisted: không expose thì webview miniapp
    // (khác origin) không đọc được và phải đoán thời gian chờ khi bị 429.
    cors: { origin: corsOrigin, credentials: true, exposedHeaders: ['Retry-After'] },
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });

  // Graceful shutdown: dọn dẹp kết nối Prisma và queue khi container nhận SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // Trust proxy: ZaloPay/Nginx/Cloudflare phía trước → req.ip = IP proxy nếu KHÔNG set,
  // mọi request share 1 counter trong ThrottlerGuard → 60req/min cho toàn site, dễ DOS lẫn nhau.
  // Set trust proxy=1 để Express lấy IP thật từ X-Forwarded-For (1 hop = reverse proxy chuẩn).
  app.set('trust proxy', 1);
  // /events nhận tối đa 50 sự kiện × 4KB props (+ envelope, escape unicode): parser riêng đặt TRƯỚC parser 10MB (body đã parse thì parser sau bỏ qua).
  app.use('/api/events', json({ limit: '512kb' }));
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
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
  return app;
}
