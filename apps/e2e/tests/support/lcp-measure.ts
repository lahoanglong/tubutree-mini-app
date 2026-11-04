import { deflateSync, crc32 } from 'zlib';
import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './mock-api';
import { CATALOG, mockDiscovery, toCard } from './discovery-mocks';
import { campaignBanner, mockCampaigns } from './campaign-mocks';
import { serverWithoutCampaigns } from './server-initial';

/** Phần dùng chung của lcp-priority.web.spec.ts và lcp-priority-db.web.spec.ts: mock ảnh, PNG nhiễu, đo ảnh ưu tiên/LCP/preload. */

export const PANCAKE = (n: number) => `https://content.pancake.vn/2-26/lcp-${n}.jpg`;
// Banner chiến dịch chỉ đi qua /img khi ảnh ở host upload (Cloudinary): API không đưa ảnh Pancake của banner vào danh sách đổi cỡ.
const CLOUD = (n: number) => `https://res.cloudinary.com/tubutree/image/upload/v1/lcp-${n}.jpg`;
const HOUR = 3_600_000;

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
export const NOISE = noisePng();

const withImages = CATALOG.map((p, i) => ({ ...p, thumbnail: PANCAKE(i) }));

export function mockImages(api: MockApi): void {
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
  mockCampaigns(api, {
    home: [campaignBanner('thu', { title: 'Giữa Thu', image: CLOUD(100) }), campaignBanner('dong', { title: 'Đông về', image: CLOUD(101) })],
    offers: [campaignBanner('uu-dai', { title: 'Ưu đãi lớn', image: CLOUD(102) })],
  });
}

interface Snapshot {
  vh: number;
  high: { src: string; top: number; loading: string | null }[];
  preloads: { html: string; hidden: boolean }[];
  lcp: { tag: string; src: string; loading: string | null; srcset: string | null; fetchpriority: string | null } | null;
}

async function measure(page: Page): Promise<Snapshot> {
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

export interface LcpRoute {
  name: string;
  path: string;
  ready: string;
  maxHigh: number;
}

/** Mở trang ở khổ 375×812 rồi kiểm: ảnh high chỉ trong màn đầu và không quá `maxHigh`, LCP là `<img>` không lazy có fetchpriority=high, không preload ảnh ẩn. */
export async function runLcp(page: Page, api: MockApi, route: LcpRoute): Promise<void> {
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
  expect(snap.high.length).toBeLessThanOrEqual(route.maxHigh);

  // 2. LCP là ảnh không lazy, fetchpriority=high; ảnh đổi cỡ (/img?) dùng srcset theo w.
  expect(snap.lcp, 'LCP phải là một phần tử').not.toBeNull();
  expect(snap.lcp!.tag).toBe('IMG');
  expect(snap.lcp!.loading).not.toBe('lazy');
  expect(snap.lcp!.fetchpriority).toBe('high');
  if (snap.lcp!.src.includes('/img?')) expect(snap.lcp!.srcset ?? '').toMatch(/\d+w(,|$)/);

  // 3. Không preload ảnh của phần tử đang ẩn ở khổ này.
  expect(snap.preloads.filter((p) => p.hidden), `preload ảnh cho phần tử ẩn: ${JSON.stringify(snap.preloads)}`).toEqual([]);
}
