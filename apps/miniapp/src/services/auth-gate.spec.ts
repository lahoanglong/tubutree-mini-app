import { describe, it, expect, vi, afterEach } from 'vitest';
import { stubFetch, type FetchCall } from '../test/fetch-stub';
import { api, setAccessToken, setAuthReady } from './api';

// Interceptor của api.ts dynamic-import '../store/auth' để lấy getDeviceId() (X-Device-Id header).
// Mock ở đây để tránh interceptor thật kéo theo zmp-sdk/apis thật (module đó đọc `window` ngay lúc
// import — vỡ dưới environment 'node' mặc định của *.spec.ts, xem vitest.config.mts). Cùng lý do
// store/auth.spec.ts đã mock 'zmp-sdk/apis' — ở đây mock thẳng '../store/auth' vì đó là thứ được
// import động, không cần chạm tới zmp-sdk.
vi.mock('../store/auth', () => ({
  getDeviceId: vi.fn().mockResolvedValue('test-device-id'),
}));

/**
 * Mở app từ push/deeplink: trang đích fetch NGAY trong khi restore() còn đang chạy. Nếu request
 * bay đi lúc chưa có access token thì BE trả 401, và React Query (retry:false cho 4xx) kẹt luôn
 * màn lỗi dù ~200ms sau phiên đã sẵn sàng.
 *
 * Thay fetch toàn cục để chặn ngay trước tầng mạng — bước chờ phiên và gắn header vẫn chạy thật.
 */
function captureFetch(): { seen: () => FetchCall | null; calls: () => number } {
  const { calls } = stubFetch(() => ({ status: 200, body: {} }));
  return { seen: () => calls.at(-1) ?? null, calls: () => calls.length };
}

describe('request chờ phiên khôi phục xong mới gửi', () => {
  afterEach(() => {
    setAuthReady(null);
    setAccessToken(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('gắn Authorization bằng token CÓ SAU khi authReady xong, không phải lúc gọi', async () => {
    const cap = captureFetch();
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
    const cap = captureFetch();
    setAuthReady(new Promise<void>(() => {})); // không bao giờ xong
    await api.post('/auth/refresh', {});
    expect(cap.calls()).toBe(1);
  });

  it('phiên treo → request vẫn đi sau trần chờ, không kẹt tới timeout của request', async () => {
    vi.useFakeTimers();
    const cap = captureFetch();
    setAuthReady(new Promise<void>(() => {}));

    const inFlight = api.get('/cart');
    // Trần chờ AUTH_READY_TIMEOUT_MS = 15_000ms (xem comment ở api.ts).
    await vi.advanceTimersByTimeAsync(15_000);
    await inFlight;
    expect(cap.calls()).toBe(1);
  });

  it('phiên khôi phục THẤT BẠI vẫn nhả request (không treo vì promise reject)', async () => {
    const cap = captureFetch();
    setAuthReady(Promise.reject(new Error('mất mạng')));
    await api.get('/products');
    expect(cap.calls()).toBe(1);
  });

  it('không có authReady (app đã chạy ổn định) → gửi ngay kèm token hiện hành', async () => {
    const cap = captureFetch();
    setAccessToken('token-cu');
    await api.get('/cart');
    expect(cap.seen()?.headers.get('Authorization')).toBe('Bearer token-cu');
  });
});
