import { expect, test, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, toCard } from './support/discovery-mocks';
import { campaignBanner, mockCampaigns } from './support/campaign-mocks';

/**
 * Web 375×812, Trang chủ và /san-pham: ảnh ưu tiên (fetchpriority=high) chỉ nằm trong màn đầu, ảnh LCP không bao giờ `loading=lazy`, và không có preload
 * ảnh cho phần tử đang ẩn ở khổ này. Ảnh sản phẩm/banner đi qua `{api}/img` (host Pancake), nên spec chặn `/api/img` và trả một PNG nhỏ: không phụ thuộc mạng.
 * Ngưỡng "tối đa 4 ảnh high": banner slide 0 + 2 thẻ Giờ vàng đầu + dấu logo (next/image priority tự đặt fetchpriority=high).
 */
test.use({ viewport: { width: 375, height: 812 } });

const PANCAKE = (n: number) => `https://content.pancake.vn/2-26/lcp-${n}.jpg`;
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HOUR = 3_600_000;

const withImages = CATALOG.map((p, i) => ({ ...p, thumbnail: PANCAKE(i) }));

function mockImages(api: MockApi): void {
  mockDiscovery(api, { tree: true });
  api.get('/products', ({ call }) => {
    const limit = Number(call.query.get('limit') ?? '20');
    const page = Number(call.query.get('page') ?? '1');
    return { data: withImages.slice((page - 1) * limit, page * limit).map(toCard), meta: { page, limit, total: withImages.length } };
  });
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return withImages.slice(4, 8).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
  mockCampaigns(api, { home: [campaignBanner('thu', { title: 'Giữa Thu', image: PANCAKE(100) }), campaignBanner('dong', { title: 'Đông về', image: PANCAKE(101) })] });
}

interface Snapshot {
  vh: number;
  high: { src: string; top: number; loading: string | null }[];
  preloads: { href: string; hidden: boolean }[];
  lcp: { tag: string; src: string; loading: string | null; srcset: string | null; fetchpriority: string | null } | null;
}

async function measure(page: import('@playwright/test').Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const lcp = await new Promise<Snapshot['lcp']>((resolve) => {
      let last: PerformanceEntry | undefined;
      new PerformanceObserver((list) => {
        last = list.getEntries().at(-1);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => {
        const el = (last as unknown as { element?: Element } | undefined)?.element;
        resolve(
          el
            ? { tag: el.tagName, src: el.getAttribute('src') ?? '', loading: el.getAttribute('loading'), srcset: el.getAttribute('srcset'), fetchpriority: el.getAttribute('fetchpriority') }
            : null,
        );
      }, 300);
    });
    const high = Array.from(document.querySelectorAll<HTMLImageElement>('img[fetchpriority="high"]')).map((img) => ({
      src: img.currentSrc || img.src, top: img.getBoundingClientRect().top, loading: img.getAttribute('loading'),
    }));
    const preloads = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')).map((l) => {
      const href = l.getAttribute('href') ?? '';
      const img = Array.from(document.images).find((i) => i.currentSrc === l.href || i.src === l.href || (i.getAttribute('src') ?? '') === href);
      const hidden = !img || img.getClientRects().length === 0 || getComputedStyle(img).visibility === 'hidden';
      return { href, hidden };
    });
    return { vh: window.innerHeight, high, preloads, lcp };
  });
}

for (const route of [{ name: 'Trang chủ', path: '/', ready: '[data-ds="product-tile"]' }, { name: 'Danh mục /san-pham', path: '/san-pham?all=1', ready: '[data-ds="product-tile"]' }]) {
  test(`LCP ${route.name} 375×812: ảnh high trong màn đầu, LCP không lazy`, async ({ page, api }) => {
    mockImages(api);
    await page.route('**/api/img?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));
    await page.goto(route.path);
    await expect(page.locator(route.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const snap = await measure(page);
    test.info().annotations.push({ type: 'LCP', description: JSON.stringify(snap.lcp) }, { type: 'high', description: JSON.stringify(snap.high.map((h) => ({ top: Math.round(h.top), src: h.src.slice(-40) }))) });
    console.log(`${route.name}: LCP=${JSON.stringify(snap.lcp)} high=${snap.high.length}`);
    console.log(JSON.stringify(snap.high));

    // 1. Mọi ảnh fetchpriority=high nằm trong màn đầu.
    for (const h of snap.high) expect(h.top, `ảnh high ngoài màn đầu: ${h.src}`).toBeLessThan(snap.vh);
    expect(snap.high.length).toBeLessThanOrEqual(4);

    // 2. LCP là ảnh không lazy; ảnh đổi cỡ (/img?) dùng srcset theo w.
    expect(snap.lcp, 'LCP phải là một phần tử').not.toBeNull();
    if (snap.lcp!.tag === 'IMG') {
      expect(snap.lcp!.loading).not.toBe('lazy');
      if (snap.lcp!.src.includes('/img?')) expect(snap.lcp!.srcset ?? '').toMatch(/\d+w(,|$)/);
    }

    // 3. Không preload ảnh của phần tử đang ẩn ở khổ này.
    expect(snap.preloads.filter((p) => p.hidden)).toEqual([]);
  });
}
