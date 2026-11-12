import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ApiUnavailableError,
  getBrand,
  getBrands,
  getProduct,
  getProducts,
  getProductsPage,
  getStorefront,
  getStorefrontList,
} from './api';
import { productMetaDescription } from './product-seo';

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

// Trang danh sách ISR: trả [] khi API chớp lỗi sẽ khiến Next lưu bản rỗng cả 300-3600 giây.
// Ném lỗi để Next giữ bản đã render tốt; riêng lúc `next build` (API thường chưa chạy) vẫn trả [].
describe.each([
  ['getProducts', () => getProducts(), { data: [{ id: 'p1' }], meta: {} }, [{ id: 'p1' }]],
  ['getBrands', () => getBrands(), [{ brand: 'Tubu', count: 2 }], [{ brand: 'Tubu', count: 2 }]],
  [
    'getStorefrontList',
    () => getStorefrontList(),
    [{ slug: 'a', updatedAt: '2026-10-01T00:00:00.000Z' }],
    [{ slug: 'a', updatedAt: '2026-10-01T00:00:00.000Z' }],
  ],
] as const)('%s — danh sách ISR', (_name, call, okBody, expected) => {
  it('thành công → trả dữ liệu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, okBody)));
    await expect(call()).resolves.toEqual(expected);
  });

  it('mất kết nối lúc runtime → ném ApiUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(call()).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it.each([429, 500, 503])('%i lúc runtime → ném ApiUnavailableError', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
    await expect(call()).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('lúc build (API chưa chạy) → trả [] để next build không hỏng', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(call()).resolves.toEqual([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(503)));
    await expect(call()).resolves.toEqual([]);
  });
});

describe('getProductsPage — trang catalog kèm tổng số (BUYERWEB-7)', () => {
  it('giữ meta.total của API (trước đây bị bỏ) và xin 24 sản phẩm/trang theo mặc định', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [{ id: 'p1' }], meta: { page: 2, limit: 24, total: 45 } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await getProductsPage({ page: '2', brand: 'Tubu' });
    expect(out.meta).toEqual({ page: 2, limit: 24, total: 45 });
    expect(out.data).toEqual([{ id: 'p1' }]);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('limit=24');
    expect(url).toContain('page=2');
    expect(url).toContain('brand=Tubu');
  });

  it('lỗi lúc runtime → ném ApiUnavailableError (không lưu bản rỗng vào ISR)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(503)));
    await expect(getProductsPage()).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('lúc build (API chưa chạy) → trang rỗng hợp lệ để next build không hỏng', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(getProductsPage()).resolves.toEqual({ data: [], meta: { page: 1, limit: 24, total: 0 } });
  });
});

describe('getStorefront — ảnh do chính API phục vụ (D3-10)', () => {
  it('đường dẫn tương đối API (ảnh base64 đã tách khỏi JSON) được ghép với gốc API công khai để thẻ img và thẻ chia sẻ dùng được', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {
      slug: 'x', avatarUrl: '/storefront/image/s1/avatar?v=abc', coverUrl: '/storefront/image/s1/cover?v=def',
    })));
    await expect(getStorefront('x')).resolves.toMatchObject({
      avatarUrl: 'http://localhost:3001/api/storefront/image/s1/avatar?v=abc',
      coverUrl: 'http://localhost:3001/api/storefront/image/s1/cover?v=def',
    });
  });

  it('URL tuyệt đối, đường dẫn // và giá trị rỗng giữ nguyên', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { slug: 'x', avatarUrl: 'https://cdn.example/a.jpg', coverUrl: null })));
    await expect(getStorefront('x')).resolves.toMatchObject({ avatarUrl: 'https://cdn.example/a.jpg', coverUrl: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { slug: 'x', avatarUrl: '//cdn.example/a.jpg' })));
    await expect(getStorefront('x')).resolves.toMatchObject({ avatarUrl: '//cdn.example/a.jpg' });
  });
});

// Nhãn gỡ đăng phải biến mất trong tối đa 60 giây (admin không gọi làm mới trang được): Data Cache của lần đọc nhãn không quá 60 giây.
describe('getBrand — hạn bộ nhớ đệm', () => {
  it('đọc /brand/public/<slug> với revalidate không quá 60 giây', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { id: 'b1' }));
    vi.stubGlobal('fetch', fetchMock);
    await getBrand('fuwa3e');
    expect((fetchMock.mock.calls[0]![1] as { next: { revalidate: number } }).next.revalidate).toBeLessThanOrEqual(60);
  });
});

// PROD để trống mô tả và thành phần ở phần lớn SKU: trang, meta và JSON-LD cùng đọc `getProduct`, nên chữ dự phòng bù ở đó.
describe('getProduct — chữ dự phòng khi PROD trống mô tả và thành phần', () => {
  const SLUG = 'xit-tram-cho-be-pineboo-150ml-b70d1d';
  const base = { id: 'p1', slug: SLUG, name: 'Xịt tràm cho bé Pineboo 150ml', brand: 'Tubu Tree', shortDesc: null, variations: [] };

  it('mô tả và thành phần rỗng → bù theo bao bì; meta description dùng được ngay thay vì câu chung chung', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { ...base, description: '', ingredients: [] })));
    const p = await getProduct(SLUG);
    expect(p!.description).toContain('Bao bì ghi eco-enzyme lên men từ vỏ dứa');
    expect(p!.ingredients!.map((i) => i.name)).toContain('Eco-enzyme lên men từ vỏ dứa');
    expect(productMetaDescription(p!)).toMatch(/^Xịt tràm cho bé Pineboo, quy cách 150ml\./);
    expect(productMetaDescription(p!)).not.toContain('sản phẩm thiên nhiên');
  });

  it('PROD đã có chữ → giữ nguyên từng trường, kể cả `percentage` dạng chuỗi', async () => {
    const ingredients = [{ name: 'Dầu tràm', percentage: '5%', benefit: 'Từ DB' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { ...base, description: 'Mô tả của DB', ingredients })));
    await expect(getProduct(SLUG)).resolves.toMatchObject({ description: 'Mô tả của DB', ingredients });
  });

  it('slug lạ → không bịa chữ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { ...base, slug: 'san-pham-la-123abc', description: '', ingredients: null })));
    await expect(getProduct('san-pham-la-123abc')).resolves.toMatchObject({ description: '', ingredients: null });
  });
});
