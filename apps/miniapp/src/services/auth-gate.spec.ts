import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { api, setAccessToken, setAuthReady } from './api';

/**
 * Mở app từ push/deeplink: trang đích fetch NGAY trong khi restore() còn đang chạy. Nếu request
 * bay đi lúc chưa có access token thì BE trả 401, và React Query (retry:false cho 4xx) kẹt luôn
 * màn lỗi dù ~200ms sau phiên đã sẵn sàng.
 *
 * Thay adapter của axios để chặn ngay trước tầng mạng — interceptor request vẫn chạy thật.
 */
const realAdapter = api.defaults.adapter;

function captureAdapter(): { seen: () => InternalAxiosRequestConfig | null; calls: () => number } {
  let last: InternalAxiosRequestConfig | null = null;
  let count = 0;
  const adapter: AxiosAdapter = (config) => {
    last = config as InternalAxiosRequestConfig;
    count += 1;
    return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  };
  api.defaults.adapter = adapter;
  return { seen: () => last, calls: () => count };
}

describe('request chờ phiên khôi phục xong mới gửi', () => {
  afterEach(() => {
    setAuthReady(null);
    setAccessToken(null);
    api.defaults.adapter = realAdapter;
    vi.useRealTimers();
  });

  it('gắn Authorization bằng token CÓ SAU khi authReady xong, không phải lúc gọi', async () => {
    const cap = captureAdapter();
    let release!: () => void;
    setAuthReady(
      new Promise<void>((resolve) => {
        release = () => {
          setAccessToken('token-sau-khi-restore');
          resolve();
        };
      }),
    );

    const inFlight = api.get('/cart');
    await Promise.resolve();
    expect(cap.calls()).toBe(0); // còn bị giữ, chưa chạm tầng mạng

    release();
    await inFlight;
    expect(cap.seen()?.headers.get('Authorization')).toBe('Bearer token-sau-khi-restore');
  });

  it('chính /auth/* KHÔNG chờ authReady (nếu chờ thì deadlock: nó là thứ tạo ra authReady)', async () => {
    const cap = captureAdapter();
    setAuthReady(new Promise<void>(() => {})); // không bao giờ xong
    await api.post('/auth/refresh', {});
    expect(cap.calls()).toBe(1);
  });

  it('phiên treo → request vẫn đi sau trần chờ, không kẹt tới timeout của axios', async () => {
    vi.useFakeTimers();
    const cap = captureAdapter();
    setAuthReady(new Promise<void>(() => {}));

    const inFlight = api.get('/cart');
    // Trần chờ AUTH_READY_TIMEOUT_MS = 15_000ms (xem comment ở api.ts).
    await vi.advanceTimersByTimeAsync(15_000);
    await inFlight;
    expect(cap.calls()).toBe(1);
  });

  it('phiên khôi phục THẤT BẠI vẫn nhả request (không treo vì promise reject)', async () => {
    const cap = captureAdapter();
    setAuthReady(Promise.reject(new Error('mất mạng')));
    await api.get('/products');
    expect(cap.calls()).toBe(1);
  });

  it('không có authReady (app đã chạy ổn định) → gửi ngay kèm token hiện hành', async () => {
    const cap = captureAdapter();
    setAccessToken('token-cu');
    await api.get('/cart');
    expect(cap.seen()?.headers.get('Authorization')).toBe('Bearer token-cu');
  });
});
