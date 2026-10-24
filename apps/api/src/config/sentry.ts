import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { HttpException } from '@nestjs/common';
import { redactUrl } from '../common/filters/redact-url';

/** Phần SDK mà module này dùng: test truyền bản giả, chạy thật dùng `@sentry/node`. */
export type SentrySdk = Pick<typeof Sentry, 'init' | 'captureException' | 'getDefaultIntegrations'>;

let on = false;

export const isSentryOn = (): boolean => on;

export function resetSentryForTest(): void {
  on = false;
}

/**
 * Chỉ giữ header vô hại (so không phân biệt hoa thường). Danh sách cho phép chứ không phải danh sách cấm: SDK chép nguyên
 * header request và mỗi nhà cung cấp webhook có header token riêng (x-accesstrade-token, x-webhook-token...).
 */
const ALLOW_HEADERS = new Set(['user-agent', 'content-type', 'content-length', 'accept', 'accept-language', 'host', 'referer']);

/** OnUnhandledRejection: xem initSentry. LocalVariables*: giá trị biến cục bộ trong stack có thể là SĐT/địa chỉ/token. */
const DROP_INTEGRATIONS = new Set(['OnUnhandledRejection', 'LocalVariables', 'LocalVariablesAsync']);

/**
 * Xoá mọi thứ có thể chứa dữ liệu khách trước khi gửi ra ngoài: cookie, header xác thực, thân request, query.
 * Breadcrumb bỏ hết vì nội dung (URL gọi ra ngoài, dòng log) khó đảm bảo sạch.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const req = event.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = redactUrl(req.url.split(/[?#]/)[0]!);
    if (req.headers) {
      req.headers = Object.fromEntries(
        Object.entries(req.headers)
          .filter(([k]) => ALLOW_HEADERS.has(k.toLowerCase()))
          // Referer của callback OAuth Zalo mang ?code=&state=.
          .map(([k, v]) => [k, k.toLowerCase() === 'referer' ? String(v).split(/[?#]/)[0]! : v]),
      );
    }
  }
  // Integration Http đặt transaction = "METHOD /đường/dẫn/thô" (token webhook nằm trong path).
  if (event.transaction) event.transaction = redactUrl(event.transaction.split(/[?#]/)[0]!);
  if (event.breadcrumbs) event.breadcrumbs = [];
  return event;
}

/**
 * Bật Sentry khi và chỉ khi SENTRY_DSN có giá trị; rỗng thì không chạm SDK (không hook, không listener).
 * Phải gọi trước khi dựng app Nest để SDK vá các thư viện trước khi chúng được require.
 * `unhandledRejection` tự bắt của SDK bị loại: main.ts đã có handler riêng (giữ process sống) và gọi captureServerError,
 * để lỗi không bị báo hai lần. `uncaughtException` vẫn do SDK bắt rồi thoát như mặc định của Node.
 */
export function initSentry(env: Record<string, string | undefined> = process.env, sdk: SentrySdk = Sentry): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || on) return on;
  const release = env.SENTRY_RELEASE?.trim();
  sdk.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    integrations: (defaults) => defaults.filter((i) => !DROP_INTEGRATIONS.has(i.name)),
    beforeSend: scrubEvent,
    beforeBreadcrumb: () => null,
  });
  on = true;
  return true;
}

/** Gửi lỗi phía server; 4xx (HttpException dưới 500) là lỗi của khách, không báo. Không làm gì khi Sentry tắt. */
export function captureServerError(err: unknown, sdk: SentrySdk = Sentry): void {
  if (!on) return;
  if (err instanceof HttpException && err.getStatus() < 500) return;
  // http-errors của body-parser/raw-body (413, 415, 400 request aborted) mang statusCode/status, không phải HttpException.
  const status = (err as { statusCode?: unknown; status?: unknown } | null)?.statusCode ?? (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status < 500) return;
  sdk.captureException(err);
}

/**
 * Lỗi Prisma: message gốc in cả tham số gọi (SĐT, địa chỉ) nên không bao giờ gửi. Chỉ gửi tên lớp, mã, model và route đã che.
 */
export function capturePrismaError(err: unknown, route: string, sdk: SentrySdk = Sentry): void {
  if (!on) return;
  const e = err as { constructor?: { name?: string }; code?: unknown; meta?: { modelName?: unknown } } | null;
  const cls = e?.constructor?.name ?? 'PrismaError';
  const code = typeof e?.code === 'string' ? ` ${e.code}` : '';
  const model = typeof e?.meta?.modelName === 'string' ? ` model=${e.meta.modelName}` : '';
  const safe = new Error(`${cls}${code}${model} on ${redactUrl(route)}`);
  safe.name = cls;
  sdk.captureException(safe);
}
