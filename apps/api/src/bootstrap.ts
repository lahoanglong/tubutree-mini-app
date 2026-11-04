import type { NestExpressApplication } from '@nestjs/platform-express';
import { CronAwareLogger } from './common/cron-run/cron-aware-logger';
import { Logger, type NestApplicationOptions, type Type } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { bodyParserErrorHandler, createBodyParsers, eventsBodyParser, pancakeWebhookTokenGuard, privateNoStoreForAuthenticated, requestInputGuard } from './common/body-limits';
import { buildCorsPolicy, cookieAuthOriginGuard, FALLBACK_WEB_ORIGINS } from './common/cors';
import { CronLeaderService } from './common/cron-leader/cron-leader.service';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { createValidationPipe } from './common/validation-pipe';
import { isSentryOn } from './config/sentry';
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
  const staticAllow = corsOrigins.length > 0 ? corsOrigins : FALLBACK_WEB_ORIGINS;
  if (isProd && corsOrigins.length === 0) {
    bootLogger.warn('CORS_ORIGINS chưa cấu hình ở production — fallback về domain chính thức.');
  }
  const { corsOrigin, isWebOrigin } = buildCorsPolicy(isProd, staticAllow);

  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    logger: opts.logger ?? new CronAwareLogger(),
  });
  // CORS phải đứng đầu chuỗi middleware: option `cors` của NestFactory chỉ gắn lúc listen, sau các app.use bên dưới,
  // nên 413/400 do parser/guard trả sẽ thiếu Access-Control-Allow-Origin và trình duyệt chỉ thấy lỗi mạng.
  // Retry-After và Content-Disposition không thuộc nhóm header CORS-safelisted: không expose thì webview miniapp
  // (khác origin) không đọc được thời gian chờ khi bị 429, và web admin không đọc được tên file CSV do máy chủ đặt.
  app.enableCors({ origin: corsOrigin, credentials: true, exposedHeaders: ['Retry-After', 'Content-Disposition'], maxAge: 7200 });
  app.use(cookieAuthOriginGuard(isWebOrigin));

  // Graceful shutdown: dọn dẹp kết nối Prisma và queue khi container nhận SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // Trust proxy: ZaloPay/Nginx/Cloudflare phía trước → req.ip = IP proxy nếu KHÔNG set,
  // mọi request share 1 counter trong ThrottlerGuard → 60req/min cho toàn site, dễ DOS lẫn nhau.
  // Set trust proxy=1 để Express lấy IP thật từ X-Forwarded-For (1 hop = reverse proxy chuẩn).
  app.set('trust proxy', 1);
  // /events nhận tối đa 50 sự kiện × 4KB props (+ envelope, escape unicode): parser riêng đặt TRƯỚC parser theo nhóm route (body đã parse thì parser sau bỏ qua).
  app.use('/api/events', eventsBodyParser());
  // Webhook Pancake (thân tới 10mb): kiểm token trước khi parse.
  app.use(pancakeWebhookTokenGuard);
  // Secret đọc từ process.env: ConfigModule đã nạp .env vào đó và JwtStrategy dùng cùng giá trị.
  // Trần theo nhóm route (mặc định 256kb; ảnh base64/CSV 10mb; webhook 1mb, Pancake 10mb), rồi duyệt khoá/phần tử/NUL trước ValidationPipe.
  app.use(...createBodyParsers(process.env.JWT_ACCESS_SECRET ?? '', Number(process.env.JWT_REFRESH_TTL_DAYS) || 30), bodyParserErrorHandler, requestInputGuard);
  app.use(privateNoStoreForAuthenticated);
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  // Map Prisma errors → HTTP status nhất quán (tránh 500 trần khi P2025/P2002/...).
  // Filter đăng ký sau được hỏi trước: Prisma lo lỗi Prisma, còn lại rơi xuống filter Sentry (chỉ có khi đã bật DSN).
  app.useGlobalFilters(
    ...(isSentryOn() ? [new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter)] : []),
    new PrismaExceptionFilter(),
  );

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
