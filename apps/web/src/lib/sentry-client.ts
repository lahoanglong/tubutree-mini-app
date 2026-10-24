import * as Sentry from '@sentry/browser';
import { scrubEvent } from './sentry-scrub';

let started = false;

/** Chỉ được nạp động từ error-report.ts khi có DSN: giữ SDK ngoài First Load JS. */
export function startClientSentry(): typeof Sentry {
  if (started) return Sentry;
  started = true;
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Không replay, không tracing; breadcrumb tắt hẳn (xem sentry-scrub).
    integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserSession'),
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
  });
  return Sentry;
}
