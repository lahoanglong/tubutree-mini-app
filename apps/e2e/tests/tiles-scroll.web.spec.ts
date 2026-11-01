import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { homeCombos, mockHomeCombos } from './support/bundle-mocks';
import { liveItem, mockFlashSlots, mockNoSession, SLOT_LIVE } from './support/flash-slot-mocks';

/**
 * Web 375px, gói F10a (P1 #1, #3, #4, #9 của review hình bước chốt), cùng bốn kiểm với tiles-scroll.miniapp.spec.ts: Trang chủ có khối cuộn chứa giá không tràn
 * ngang (lỗi gốc: chữ đọc ẩn của PriceTag trong ComboCard thoát vùng cuộn, trang rộng 399px), tên món thẻ Giờ vàng một dòng, dòng meta không bị cắt giữa số,
 * ghi chú Giờ vàng nói con số giới hạn trước. Chỉ chạy ở khổ điện thoại (đặt viewport 375/320 trong spec). Mọi lời gọi /api/** từ trình duyệt đi qua mock;
 * phần Next gọi API ở server không mock được nên `refetchStale` đẩy đồng hồ để dữ liệu SSR hết tươi rồi tải lại qua mock (như shop.web.spec.ts).
 * `F10A_SHOTS=<thư mục>` ghi ảnh vào `<thư mục>/web375` (ảnh trước/sau; thư mục ảnh bị gitignore). Host phải là localhost.
 */

const HOUR = 3_600_000;
const LONG_NAME = 'Ẩm Ổn Định Dầu Gội Thảo Mộc Bồ Kết Hương Sả Chanh Nguyên Chất Dung Tích Lớn';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'Web Customer', 'chỉ khổ điện thoại');
});

const card = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, slug: `sp-${id}`, name, brand: 'Tubu', thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true,
  ratingAvg: 4.7, reviewCount: 30, sold: 8_200, ...over,
});
const pageOf = (data: unknown[], limit = 20) => ({ data, meta: { page: 1, limit, total: data.length } });

const BEST = [
  card('b1', 'Nước rửa chén sinh học hương chanh sả', { sold: 8_200 }),
  card('b2', LONG_NAME, { ratingAvg: 5, sold: 99_900, salePrice: 80_000 }),
  card('b3', 'Xà phòng', { ratingAvg: undefined, sold: 12 }),
  card('b4', 'Túi vải canvas', { sold: 999, ratingAvg: 4.2 }),
  card('b5', 'Ống hút tre', { ratingAvg: 4.9, sold: 1_234 }),
];
const FEED = [card('f1', 'Sản phẩm gợi ý một', { sold: 340 }), card('f2', 'Sản phẩm gợi ý hai dài hơn một chút', { sold: 1_234 }), card('f3', 'Gợi ý ba', { sold: 8_200 }), card('f4', 'Gợi ý bốn', { sold: 52 })];

/** Làm dữ liệu SSR hết tươi rồi kích tải lại khi có mạng trở lại; lặp tới khi mock nhận được lời gọi (chép từ shop.web.spec.ts). */
async function refetchStale(page: Page, api: MockApi, method: string, pattern: string, minCalls = 1) {
  await page.waitForFunction(() => {
    const all = document.querySelectorAll('main *');
    const last = all[all.length - 1];
    return !!last && Object.keys(last).some((k) => k.startsWith('__reactFiber$'));
  }, undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __tubuClockOffset?: number };
    if (w.__tubuClockOffset === undefined) {
      w.__tubuClockOffset = 0;
      const real = Date.now.bind(Date);
      Date.now = () => real() + (w.__tubuClockOffset ?? 0);
    }
    w.__tubuClockOffset += 10 * 60_000;
  });
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      return api.callsTo(method, pattern).length;
    }, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(minCalls);
}

function mockHome(api: MockApi): void {
  api.get('/categories', [
    { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4, children: [] },
    { id: 'c-xa', parentId: null, name: 'Xà phòng', slug: 'xa-phong', image: null, sortOrder: 2, productCount: 2, children: [] },
  ]);
  api.get('/brands', [{ brand: 'Tubu', count: 3 }]);
  api.get('/search/suggest', []);
  api.get('/products', ({ call }) => (call.query.get('sort') === 'best_seller_30d' ? pageOf(BEST, 12) : pageOf(FEED)));
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12, loyalty: { vndPerPoint: 50, vndPerPointRedeem: 1000 } });
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    const names = [LONG_NAME, 'Xà phòng', 'Nước rửa bình sữa cho bé hương dịu nhẹ an toàn', 'Khăn ướt không cồn Bé Na'];
    return names.map((name, i) => ({
      itemId: `fi-${i}`, variationId: `v-fi-${i}`, productSlug: `gv-${i}`, productName: name, variationName: i === 0 ? 'Gói 80 tờ' : null, thumbnail: null,
      flashPrice: 59_000 + i * 1_000, retailPrice: 100_000, salePrice: null, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
  api.get('/flash-sales/upcoming', []);
  mockHomeCombos(api, homeCombos());
}

async function shot(target: Page | Locator, name: string): Promise<void> {
  const dir = process.env.F10A_SHOTS;
  if (!dir) return;
  const out = join(dir, 'web375');
  mkdirSync(out, { recursive: true });
  await target.screenshot({ path: join(out, `${name}.png`) });
}

async function clippedMeta(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-ds-part="meta"]'))
      .filter((el) => (el.textContent ?? '').trim() !== '' && el.getBoundingClientRect().width > 0)
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => `${el.closest<HTMLElement>('[data-ds="product-tile"]')?.dataset.dsVariant ?? '?'}: "${Array.from(el.children).find((c) => getComputedStyle(c).display !== 'none')?.textContent ?? el.textContent}" ${el.scrollWidth}>${el.clientWidth}`),
  );
}

async function openHome(page: Page, api: MockApi, width = 375): Promise<void> {
  await page.setViewportSize({ width, height: 812 });
  await page.goto('/');
  await refetchStale(page, api, 'GET', '/products');
  await expect(page.getByRole('region', { name: 'Giờ vàng', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Bán chạy nhất', exact: true }).locator('[data-ds="product-tile"]')).toHaveCount(BEST.length, { timeout: 15_000 });
  await expect(page.getByTestId('home-combos')).toBeVisible({ timeout: 15_000 });
}

test.describe('Web 375px: thẻ và hàng cuộn của Trang chủ', () => {
  test('Trang chủ có Giờ vàng, Bán chạy, Combo: trang không tràn ngang (thanh điều hướng dưới không rơi khỏi màn)', async ({ page, api }) => {
    mockHome(api);
    await openHome(page, api);
    await shot(page.getByRole('region', { name: 'Giờ vàng', exact: true }), 'home-flash');
    await shot(page.getByTestId('home-combos'), 'home-combos');
    await shot(page, 'home-top');
    const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(width.doc, `tài liệu rộng ${width.doc}px, màn ${width.client}px`).toBeLessThanOrEqual(width.client);
  });

  test('thẻ Giờ vàng: tên một dòng dù tên dài có dấu, mọi thẻ cùng kệ cao bằng nhau', async ({ page, api }) => {
    mockHome(api);
    await openHome(page, api);
    const rail = page.getByRole('region', { name: 'Giờ vàng, vuốt ngang để xem thêm', exact: true });
    const tiles = await rail.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('[data-ds="product-tile"]')).map((t) => ({
        name: t.querySelector<HTMLElement>('.tubu-tile-link > span')!.getBoundingClientRect().height,
        body: t.querySelector<HTMLElement>('[data-ds-part="body"]')!.getBoundingClientRect().height,
        tile: t.getBoundingClientRect().height,
      })),
    );
    expect(tiles).toHaveLength(4);
    for (const t of tiles) expect(t.name, 'ô tên thẻ Giờ vàng').toBeLessThanOrEqual(20);
    expect(Math.max(...tiles.map((t) => t.tile)) - Math.min(...tiles.map((t) => t.tile)), 'chiều cao thẻ cùng kệ').toBeLessThanOrEqual(1);
    expect(Math.max(...tiles.map((t) => t.body)) - Math.min(...tiles.map((t) => t.body)), 'chiều cao thân thẻ cùng kệ').toBeLessThanOrEqual(1);
  });

  for (const width of [375, 320]) {
    test(`${width}px: dòng meta của kệ Bán chạy nhất và lưới Gợi ý không bị cắt giữa số`, async ({ page, api }) => {
      mockHome(api);
      await openHome(page, api, width);
      const best = page.getByRole('region', { name: 'Bán chạy nhất', exact: true });
      await best.scrollIntoViewIfNeeded();
      await shot(best, `home-best-${width}`);
      await page.getByRole('region', { name: 'Gợi ý hôm nay' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' }).locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
      expect(await clippedMeta(page)).toEqual([]);
    });
  }
});

test.describe('Web 375px: ghi chú Giờ vàng ở /gio-vang', () => {
  test('con số giới hạn đứng trước tên phân loại và hiện đủ', async ({ page, api }) => {
    mockNoSession(api);
    mockFlashSlots(api, { items: { [SLOT_LIVE.id]: [liveItem(1, { variationName: 'Gói 80 tờ', perUserLimit: 2 }), liveItem(2, { variationName: 'Gói 80 tờ', perUserLimit: 2 })] } });
    api.get('/config/public', { freeshipThreshold: 350000 });
    api.get('/products', pageOf([]));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/gio-vang');
    const notes = page.locator('[data-ds-part="note"]');
    await expect(notes).toHaveCount(2, { timeout: 15_000 });
    await shot(page, 'gio-vang');
    const first = await notes.first().evaluate((el) => {
      const text = el.firstChild as Text;
      const limit = 'Tối đa 2/khách';
      if (!(el.textContent ?? '').startsWith(limit)) return { text: el.textContent ?? '', ok: false };
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, limit.length);
      return { text: el.textContent ?? '', ok: range.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5 };
    });
    expect(first.text).toMatch(/^Tối đa 2\/khách/);
    expect(first.ok, `ghi chú "${first.text}" bị cắt trước con số`).toBe(true);
  });
});
