import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBrand, getProduct, getProducts, getStorefront } from './api';

function res(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Chỉ 404 mới được thành "không tìm thấy"; 429/5xx/mất kết nối phải ném lỗi để Next hiện
// error boundary (ISR giữ bản cũ) thay vì trả 404 cho Googlebot với sản phẩm còn bán.
describe.each([
  ['getProduct', getProduct],
  ['getStorefront', getStorefront],
  ['getBrand', getBrand],
] as const)('%s — phân biệt 404 với lỗi tạm thời', (_name, fn) => {
  it('404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    await expect(fn('x')).resolves.toBeNull();
  });

  it('200 → dữ liệu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { slug: 'x' })));
    await expect(fn('x')).resolves.toEqual({ slug: 'x' });
  });

  it.each([429, 500, 502, 503])('%i → ném lỗi, KHÔNG trả null', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
    await expect(fn('x')).rejects.toThrow(String(status));
  });

  it('mất kết nối tới API → ném lỗi, KHÔNG trả null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(fn('x')).rejects.toThrow();
  });
});

describe('header miễn throttle khi SSR', () => {
  it('có THROTTLE_BYPASS_TOKEN → gửi x-throttle-bypass', async () => {
    vi.stubEnv('THROTTLE_BYPASS_TOKEN', 'a'.repeat(40));
    const f = vi.fn().mockResolvedValue(res(200, { data: [] }));
    vi.stubGlobal('fetch', f);
    await getProducts();
    await getProduct('x').catch(() => undefined);
    for (const call of f.mock.calls) {
      const headers = new Headers((call[1] as RequestInit).headers);
      expect(headers.get('x-throttle-bypass')).toBe('a'.repeat(40));
    }
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('biến rỗng → không gửi header', async () => {
    vi.stubEnv('THROTTLE_BYPASS_TOKEN', '');
    const f = vi.fn().mockResolvedValue(res(200, { data: [] }));
    vi.stubGlobal('fetch', f);
    await getProducts();
    const headers = new Headers((f.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.has('x-throttle-bypass')).toBe(false);
  });

  it('chạy trong trình duyệt → không gửi header dù biến có giá trị', async () => {
    vi.stubEnv('THROTTLE_BYPASS_TOKEN', 'a'.repeat(40));
    vi.stubGlobal('window', {});
    const f = vi.fn().mockResolvedValue(res(200, { data: [] }));
    vi.stubGlobal('fetch', f);
    await getProducts();
    const headers = new Headers((f.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.has('x-throttle-bypass')).toBe(false);
  });
});
