// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const api = vi.hoisted(() => ({ result: null as unknown, tokens: [] as string[] }));
const spies = vi.hoisted(() => ({ track: vi.fn(), trackPdp: vi.fn(), addToCart: vi.fn(), getCart: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPreviewProduct: async (token: string) => {
    api.tokens.push(token);
    return api.result;
  },
}));
vi.mock('@/lib/use-flash-sales', () => ({
  useActiveFlashSales: () => [],
  useRunningFlash: () => ({ flash: [], now: Date.now() }),
  FlashSalesSeed: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackWebEvent: spies.track,
  trackPurchase: spies.track,
  trackScreenView: spies.track,
  trackOncePerSession: spies.track,
}));
vi.mock('@/components/analytics/funnel', () => ({ trackPdpAction: spies.trackPdp }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  addToCart: spies.addToCart,
  getCart: spies.getCart,
}));

import Page, { metadata } from './page';
import SlugPage, { dynamic as slugDynamic } from './[slug]/page';
import { dynamic } from './page';
import { PREVIEW_COPY } from './preview-copy';

const PRODUCT = {
  id: 'p1',
  slug: 'nuoc-rua-chen-bo-ket',
  brand: 'Xanh Việt',
  name: 'Nước rửa chén bồ kết (bản MSS)',
  shortDesc: 'Sạch dầu mỡ, dịu tay',
  description:
    '<p>Đoạn <strong>đậm</strong> an toàn</p><ul><li>Bồ kết</li><li>Vỏ bưởi</li></ul><script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2"><a href="javascript:alert(1)">bấm</a>',
  images: ['https://media.mss.test/1.jpg', 'https://media.mss.test/2.jpg', 'https://media.mss.test/3.jpg', 'https://media.mss.test/4.jpg', 'https://media.mss.test/5.jpg'],
  videos: ['https://media.mss.test/v.mp4'],
  thumbnail: 'https://media.mss.test/1.jpg',
  basePrice: 89000,
  salePrice: null,
  certifications: ['Không paraben'],
  variations: [{ id: 'v1', sku: 'NRC-500', name: '500ml', retailPrice: 89000, salePrice: null, stock: 4 }],
  ingredients: [{ name: 'Bồ kết', benefit: 'Làm sạch dịu' }],
  ratingAvg: 4.8,
  reviewCount: 3,
};
const OK = { kind: 'ok', product: PRODUCT, preview: { version: 7, expiresAt: '2026-11-17T03:15:00.000Z' } };

let mounted: Rendered[] = [];
const renderPage = async (search: Record<string, string>, which: typeof Page = Page) => {
  const ui = await which({ searchParams: Promise.resolve(search) } as never);
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};

beforeEach(() => {
  api.result = OK;
  api.tokens = [];
  Object.values(spies).forEach((s) => s.mockReset());
  (window as unknown as { __pwned?: number }).__pwned = undefined;
  window.history.replaceState(null, '', '/san-pham/_preview?token=t&frame=miniapp');
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.className = '';
});

describe('trang xem trước MSS', () => {
  it('cấu hình trang: dựng mỗi lượt (force-dynamic), noindex/nofollow, hai đường cùng một trang', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(slugDynamic).toBe('force-dynamic');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(SlugPage).toBe(Page);
  });

  it('có băng BẢN XEM TRƯỚC cố định đầu trang kèm số bản và giờ hết hạn theo giờ Việt Nam', async () => {
    const c = await renderPage({ token: 'tok', frame: 'web' });
    expect(api.tokens).toEqual(['tok']);
    const banner = c.querySelector('[data-testid="preview-banner"]')!;
    expect(banner.textContent).toContain('BẢN XEM TRƯỚC');
    expect(banner.textContent).toContain('Bản 7, hết hạn lúc 10:15 17/11/2026');
    expect(banner.className).toContain('sticky');
    expect(banner.className).toContain('top-0');
    expect(c.firstElementChild!.firstElementChild).toBe(banner);
  });

  it('dựng nội dung bằng thành phần PDP: tên, nhãn hàng, mô tả ngắn, Thành phần, mô tả lọc HTML, 5 ảnh + 1 video', async () => {
    const c = await renderPage({ token: 'tok' });
    expect(c.querySelector('h1')!.textContent).toBe(PRODUCT.name);
    expect(c.querySelector('[data-testid="preview-brand"]')!.textContent).toContain('Xanh Việt');
    expect(c.querySelector('[data-testid="pdp-short-desc"]')!.textContent).toBe('Sạch dầu mỡ, dịu tay');
    expect(c.querySelector('[data-pdp-block="ingredients"]')!.textContent).toContain('Bồ kết');
    expect(c.querySelector('[data-testid="pdp-price"]')!.textContent).toContain('89.000');
    expect(c.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(6);
    expect(Array.from(c.querySelectorAll('[aria-roledescription="slide"]')).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Ảnh 1 trên 6',
      'Ảnh 2 trên 6',
      'Ảnh 3 trên 6',
      'Ảnh 4 trên 6',
      'Ảnh 5 trên 6',
      'Video 6 trên 6',
    ]);
    const desc = c.querySelector('[data-pdp-block="description"]')!;
    expect(desc.querySelector('strong')!.textContent).toBe('đậm');
    expect(desc.querySelectorAll('li')).toHaveLength(2);
    expect(desc.querySelector('script, img, a, [onerror]')).toBeNull();
    expect(desc.textContent).not.toMatch(/<|script|onerror|javascript:/i);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('nút mua là nút disabled thật; không có khối mua, tim, chia sẻ, chat, đánh giá, dải gợi ý; không gọi giỏ', async () => {
    const c = await renderPage({ token: 'tok', frame: 'miniapp' });
    const buys = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-testid="preview-buy"]'));
    expect(buys.length).toBeGreaterThan(0);
    for (const b of buys) {
      expect(b.disabled).toBe(true);
      expect(b.textContent).toBe(PREVIEW_COPY.buy);
      click(b);
    }
    await flush();
    for (const id of ['pdp-add-to-cart', 'buy-now', 'pdp-buy-now', 'wishlist-heart', 'share-button', 'pdp-chat', 'pdp-reviews', 'pdp-rails']) {
      expect(c.querySelector(`[data-testid="${id}"]`), id).toBeNull();
    }
    expect(c.querySelector('[data-pdp-block="reviews"], [data-pdp-block="rails"], [data-pdp-block="promises"]')).toBeNull();
    expect(c.querySelectorAll('a[href]')).toHaveLength(0);
    expect(spies.addToCart).not.toHaveBeenCalled();
    expect(spies.getCart).not.toHaveBeenCalled();
  });

  it('không ghi sự kiện phân tích: phát video và vuốt ảnh không gọi hàm đo nào; mã nguồn không dùng thành phần đo hay ghi', async () => {
    const c = await renderPage({ token: 'tok' });
    const play = c.querySelector<HTMLElement>('[aria-roledescription="slide"] button');
    if (play) click(play);
    click(c.querySelector('button[aria-label="Ảnh sau"]'));
    await flush();
    expect(spies.track).not.toHaveBeenCalled();
    expect(spies.trackPdp).not.toHaveBeenCalled();
    const src = ['preview-page.tsx', 'preview-product.tsx', 'preview-notice.tsx'].map((f) => readFileSync(join(__dirname, f), 'utf8')).join('\n');
    for (const banned of ['ProductViewTracker', 'RecordRecentlyViewed', 'WishlistHeart', 'ShareButton', 'AddToCart', 'PdpChatButton', 'ProductReviews', 'PdpRails', 'PdpBundles', 'trackPdpAction', 'trackWebEvent', 'pdpSlug']) {
      expect(src, banned).not.toContain(banned);
    }
  });

  it('frame=miniapp: khung tối đa 390px (24.375rem) giữa màn; frame=web hay thiếu: khung PDP web thường', async () => {
    const mini = await renderPage({ token: 'tok', frame: 'miniapp' });
    const frame = mini.querySelector('[data-preview-frame]')!;
    expect(frame.getAttribute('data-preview-frame')).toBe('miniapp');
    expect(frame.className).toContain('max-w-[24.375rem]');
    expect(frame.className).toContain('mx-auto');
    for (const search of [{ token: 'tok', frame: 'web' }, { token: 'tok' }, { token: 'tok', frame: 'la' }] as Record<string, string>[]) {
      const web = await renderPage(search);
      const f = web.querySelector('[data-preview-frame]')!;
      expect(f.getAttribute('data-preview-frame')).toBe('web');
      expect(f.className).toContain('max-w-frame');
    }
  });

  it('token thiếu, rỗng hoặc hết hạn: báo ngay trong trang "Phiên xem trước đã hết hạn, mở lại từ MSS", giữ băng và khung, không nút', async () => {
    api.result = { kind: 'expired' };
    for (const search of [{ frame: 'miniapp' }, { token: '  ', frame: 'miniapp' }, { token: 'cu', frame: 'miniapp' }] as Record<string, string>[]) {
      const c = await renderPage(search);
      expect(c.querySelector('[data-preview-frame]')!.getAttribute('data-preview-frame')).toBe('miniapp');
      expect(c.querySelector('[data-testid="preview-banner"]')).not.toBeNull();
      expect(c.querySelector('[data-problem="expired"] [data-testid="error-message"]')!.textContent).toBe('Phiên xem trước đã hết hạn, mở lại từ MSS');
      expect(c.querySelector('button')).toBeNull();
      expect(c.querySelector('[data-testid="preview-buy"]')).toBeNull();
    }
    expect(api.tokens).toEqual(['cu']);
  });

  it('MSS chưa trả được bản nháp (503): câu riêng kèm Thử lại; sản phẩm chưa có trên Tubu: câu riêng, không nút', async () => {
    api.result = { kind: 'unavailable' };
    const c = await renderPage({ token: 'tok' });
    expect(c.querySelector('[data-testid="error-message"]')!.textContent).toBe('MSS chưa trả được bản nháp, thử lại sau');
    expect(c.querySelector('button')!.textContent).toBe('Thử lại');
    expect(c.querySelector('[data-testid="preview-buy"]')).toBeNull();
    api.result = { kind: 'missing' };
    const m = await renderPage({ token: 'tok' });
    expect(m.querySelector('[data-problem="missing"] [data-testid="error-message"]')!.textContent).toContain('chưa có trên Tubu Tree');
    expect(m.querySelector('button')).toBeNull();
  });
});

describe('getPreviewProduct', () => {
  const real = () => vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  afterEach(() => vi.unstubAllGlobals());

  it('gọi /mss/preview/product với token mã hoá, không bộ đệm; 200 tách `preview` khỏi sản phẩm', async () => {
    const f = reply(200, { ...PRODUCT, preview: { version: 7, expiresAt: '2026-11-17T03:15:00.000Z' } });
    vi.stubGlobal('fetch', f);
    const res = await (await real()).getPreviewProduct('a.b+c/=');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/mss\/preview\/product\?token=a\.b%2Bc%2F%3D$/);
    expect(init.cache).toBe('no-store');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.preview).toEqual({ version: 7, expiresAt: '2026-11-17T03:15:00.000Z' });
    expect(res.product.slug).toBe(PRODUCT.slug);
    expect('preview' in res.product).toBe(false);
  });

  it('404 preview_expired → expired; 404 not_found → missing; 503, 500, mất mạng hay thân hỏng → unavailable', async () => {
    const cases: [ReturnType<typeof vi.fn>, string][] = [
      [reply(404, { error: 'preview_expired', message: 'Phiên xem trước đã hết hạn, mở lại từ MSS' }), 'expired'],
      [reply(404, { statusCode: 404 }), 'expired'],
      [reply(404, { error: 'not_found', message: 'Sản phẩm chưa có trên Tubu' }), 'missing'],
      [reply(503, { error: 'preview_unavailable' }), 'unavailable'],
      [reply(500, {}), 'unavailable'],
      [reply(200, { slug: 'x' }), 'unavailable'],
      [vi.fn(async () => Promise.reject(new TypeError('fetch failed'))), 'unavailable'],
    ];
    const { getPreviewProduct } = await real();
    for (const [f, want] of cases) {
      vi.stubGlobal('fetch', f);
      expect((await getPreviewProduct('t')).kind).toBe(want);
    }
  });
});
