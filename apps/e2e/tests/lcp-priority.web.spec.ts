import path from 'path';
import { deflateSync, crc32 } from 'zlib';
import { expect, test, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, toCard } from './support/discovery-mocks';
import { campaignBanner, mockCampaigns } from './support/campaign-mocks';
import { serverWithoutCampaigns } from './support/server-initial';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';

/**
 * Web 375×812, Trang chủ và /san-pham: ảnh ưu tiên (fetchpriority=high) chỉ nằm trong màn đầu, ảnh LCP là một `<img>` không `loading=lazy`, và không có preload
 * ảnh cho phần tử đang ẩn ở khổ này. Ảnh sản phẩm/banner đi qua `{api}/img` (host Pancake), nên spec chặn `/api/img` và trả một PNG nhiễu: không phụ thuộc mạng, và đủ
 * "entropy" (Chrome không tính ảnh dưới ~0,05 bit/điểm ảnh vào LCP, ảnh 1×1 làm LCP rơi về một đoạn chữ).
 * Danh sách /san-pham do máy chủ web dựng từ DB e2e (thumbnail null): spec gán tạm ảnh cho sản phẩm rồi trả lại (chỉ ghi DB tạm, như a11y-db.ts).
 * Ngưỡng "tối đa 4 ảnh high": banner slide 0 + 2 thẻ Giờ vàng đầu + dấu logo Trang chủ (next/image priority tự đặt fetchpriority=high).
 */
test.use({ viewport: { width: 375, height: 812 } });

const PANCAKE = (n: number) => `https://content.pancake.vn/2-26/lcp-${n}.jpg`;

/** PNG RGB nhiễu 160×160 (~75 KB): đủ entropy để Chrome tính vào LCP dù ảnh được kéo giãn ra khung 343×137. */
function noisePng(size = 160): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    head.copy(out, 4);
    out.writeUInt32BE(crc32(head), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  let seed = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 1; x < row; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[y * row + x] = seed >> 16;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const NOISE = noisePng();
const DB_THUMB = 'https://content.pancake.vn/2-26/lcp-db.jpg';

async function withPrisma<T>(fn: (prisma: { product: { updateMany(args: unknown): Promise<unknown> } }) => Promise<T>): Promise<T | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

let seeded = false;
test.beforeAll(async () => {
  seeded = (await withPrisma((p) => p.product.updateMany({ where: { thumbnail: null }, data: { thumbnail: DB_THUMB } }))) !== null;
});
test.afterAll(async () => {
  await withPrisma((p) => p.product.updateMany({ where: { thumbnail: DB_THUMB }, data: { thumbnail: null } }));
});
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
  preloads: { html: string; hidden: boolean }[];
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
    // Preload ảnh của next/image mang `imagesrcset` (không có href): so với srcset hoặc src của thẻ img cùng nguồn.
    const preloads = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')).map((l) => {
      const set = l.getAttribute('imagesrcset') ?? '';
      const href = l.getAttribute('href') ?? '';
      const img = Array.from(document.images).find((i) => (set !== '' && i.getAttribute('srcset') === set) || (href !== '' && (i.currentSrc === l.href || i.getAttribute('src') === href)));
      const hidden = !img || img.getClientRects().length === 0 || getComputedStyle(img).visibility === 'hidden';
      return { html: l.outerHTML.slice(0, 300), hidden };
    });
    return { vh: window.innerHeight, high, preloads, lcp };
  });
}

for (const route of [{ name: 'Trang chủ', path: '/', ready: '[data-ds="product-tile"]' }, { name: 'Danh mục /san-pham', path: '/san-pham?all=1', ready: '[data-ds="product-tile"]' }]) {
  test(`LCP ${route.name} 375×812: ảnh high trong màn đầu, LCP không lazy`, async ({ page, api }) => {
    test.skip(!seeded, 'DB không phải DB tạm: không gán được ảnh cho sản phẩm');
    mockImages(api);
    const stripped = route.path === '/' ? await serverWithoutCampaigns(page) : null;
    await page.route('**/api/img?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: NOISE }));
    await page.goto(route.path);
    if (stripped) expect(stripped.found(), 'Trang chủ không còn nhúng danh sách chiến dịch: banner sẽ không có').toBeGreaterThan(0);
    await expect(page.locator(route.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const snap = await measure(page);
    test.info().annotations.push({ type: 'LCP', description: JSON.stringify(snap.lcp) }, { type: 'high', description: JSON.stringify(snap.high.map((h) => ({ top: Math.round(h.top), src: h.src.slice(-40) }))) });
    console.log(`${route.name}: LCP=${JSON.stringify(snap.lcp)} high=${snap.high.length}`);
    console.log(JSON.stringify(snap.high));

    // 1. Mọi ảnh fetchpriority=high nằm trong màn đầu.
    for (const h of snap.high) expect(h.top, `ảnh high ngoài màn đầu: ${h.src}`).toBeLessThan(snap.vh);
    expect(snap.high.length, 'phải có ảnh ưu tiên').toBeGreaterThan(0);
    expect(snap.high.length).toBeLessThanOrEqual(4);

    // 2. LCP là ảnh không lazy, fetchpriority=high; ảnh đổi cỡ (/img?) dùng srcset theo w.
    expect(snap.lcp, 'LCP phải là một phần tử').not.toBeNull();
    expect(snap.lcp!.tag).toBe('IMG');
    expect(snap.lcp!.loading).not.toBe('lazy');
    expect(snap.lcp!.fetchpriority).toBe('high');
    if (snap.lcp!.src.includes('/img?')) expect(snap.lcp!.srcset ?? '').toMatch(/\d+w(,|$)/);

    // 3. Không preload ảnh của phần tử đang ẩn ở khổ này.
    expect(snap.preloads.filter((p) => p.hidden), `preload ảnh cho phần tử ẩn: ${JSON.stringify(snap.preloads)}`).toEqual([]);
  });
}
