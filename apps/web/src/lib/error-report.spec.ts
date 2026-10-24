import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('./sentry-client');
});

describe('error-report', () => {
  it('không có DSN: không nạp SDK, không ném', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const loaded = vi.fn();
    vi.doMock('./sentry-client', () => {
      loaded();
      return { startClientSentry: vi.fn() };
    });
    const { reportError, startErrorReporting } = await import('./error-report');
    reportError(new Error('x'));
    startErrorReporting();
    await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
  });

  it('có DSN: nạp SDK một lần và gửi lỗi', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://k@o.example.com/1');
    const captureException = vi.fn();
    const startClientSentry = vi.fn(() => ({ captureException }));
    vi.doMock('./sentry-client', () => ({ startClientSentry }));
    const { reportError } = await import('./error-report');
    const err = new Error('x');
    reportError(err);
    reportError(err);
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(2));
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('SDK nạp hỏng không làm báo lỗi ném ra ngoài', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://k@o.example.com/1');
    vi.doMock('./sentry-client', () => {
      throw new Error('chunk load failed');
    });
    const { reportError } = await import('./error-report');
    expect(() => reportError(new Error('x'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
