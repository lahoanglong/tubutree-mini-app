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

/** Header nhạy cảm: so không phân biệt hoa thường. */
const DROP_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-webhook-token', 'x-throttle-bypass', 'x-api-key']);

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
    if (req.url) req.url = redactUrl(req.url.split('?')[0]!);
    if (req.headers) {
      req.headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())));
    }
  }
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
    tracesSampleRate: 0,
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
  sdk.captureException(err);
}
