/**
 * Cổng duy nhất tới Sentry phía trình duyệt. Không có NEXT_PUBLIC_SENTRY_DSN lúc build thì cả nhánh nạp động bị
 * webpack cắt, nên SDK không vào bundle; có DSN thì SDK nằm ở chunk riêng, chỉ tải khi cần.
 */
type SentryClient = typeof import('./sentry-client');

let loading: Promise<SentryClient> | undefined;

function load(): Promise<SentryClient> | undefined {
  // Phải viết thẳng process.env.NEXT_PUBLIC_* trong điều kiện để webpack thay chuỗi và cắt nhánh chết.
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    loading ??= import('./sentry-client');
  }
  return loading;
}

/** Gắn bộ bắt lỗi toàn cục (window.onerror, unhandledrejection) sau khi trang đã hydrate. */
export function startErrorReporting(): void {
  void load()?.then((m) => m.startClientSentry()).catch(() => {});
}

/** Báo lỗi đã bị error boundary bắt. Không bao giờ ném: báo lỗi hỏng không được làm hỏng thêm trang đang lỗi. */
export function reportError(error: unknown): void {
  void load()
    ?.then((m) => m.startClientSentry().captureException(error))
    .catch(() => {});
}
