import * as Sentry from '@sentry/node';
import { scrubEvent } from './sentry-scrub';

/** Khởi tạo từ instrumentation.ts, chỉ khi SENTRY_DSN có giá trị. */
export function startServerSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Giá trị biến cục bộ trong stack có thể là SĐT/địa chỉ/token.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'LocalVariables' && i.name !== 'LocalVariablesAsync'),
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
  });
}
