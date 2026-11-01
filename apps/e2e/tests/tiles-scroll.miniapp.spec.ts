import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { THUMB } from './support/buy-flow-mocks';
import { catalogHandler, mockDiscovery } from './support/discovery-mocks';
import { homeCombos, mockHomeCombos } from './support/bundle-mocks';
import { liveItem, mockFlashSlots, SLOT_LIVE } from './support/flash-slot-mocks';
import type { PageResponse, ProductCard } from '../../miniapp/src/services/shop-api';

/**
 * Mini App 375px, gói F10a (P1 #1, #3, #4, #9 của review hình bước chốt): Trang chủ có khối cuộn chứa giá không tràn ngang, tên món thẻ Giờ vàng
 * đúng một dòng, dòng meta của thẻ hẹp không bị cắt giữa số, ghi chú Giờ vàng nói con số giới hạn trước. API mock toàn bộ, không waitForTimeout.
 * `F10A_SHOTS=<thư mục>` ghi ảnh từng khối vào `<thư mục>/mini375` (ảnh trước/sau; thư mục ảnh bị gitignore).
 */

const HOUR = 3_600_000;
const LONG_NAME = 'Ẩm Ổn Định Dầu Gội Thảo Mộc Bồ Kết Hương Sả Chanh Nguyên Chất Dung Tích Lớn';

const card = (id: string, name: string, over: Partial<ProductCard> = {}): ProductCard => ({
  id, slug: `sp-${id}`, name, brand: 'Tubu', thumbnail: THUMB, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true,
  ratingAvg: 4.7, reviewCount: 30, sold: 8_200, ...over,
});

/** Kệ Bán chạy nhất: số bán và sao lệch nhau để gặp cả ca meta dài nhất ("★ 5,0 · Đã bán 99,9k+") lẫn ca thiếu sao. */
const BEST: ProductCard[] = [
  card('b1', 'Nước rửa chén sinh học hương chanh sả', { sold: 8_200 }),
  card('b2', LONG_NAME, { ratingAvg: 5, sold: 99_900, salePrice: 80_000 }),
  card('b3', 'Xà phòng', { ratingAvg: undefined, sold: 12 }),
  card('b4', 'Túi vải canvas', { sold: 999, ratingAvg: 4.2 }),
  card('b5', 'Ống hút tre', { ratingAvg: 4.9, sold: 1_234 }),
];

function mockHome(api: MockApi): void {
  mockDiscovery(api, { returning: true });
  // Đăng ký SAU mockDiscovery để thắng mặc định; lời gọi khác vẫn qua bộ lọc danh mục giả.
  const catalog = catalogHandler();
  api.get('/products', (ctx): PageResponse<ProductCard> | ReturnType<typeof catalog> =>
    ctx.call.query.get('sort') === 'best_seller_30d' ? { data: BEST, meta: { page: 1, limit: 12, total: BEST.length } } : catalog(ctx));
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    const names = [LONG_NAME, 'Xà phòng', 'Nước rửa bình sữa cho bé hương dịu nhẹ an toàn', 'Khăn ướt không cồn Bé Na'];
    return names.map((name, i) => ({
      itemId: `fi-${i}`, variationId: `v-fi-${i}`, productSlug: `gv-${i}`, productName: name, variationName: i === 0 ? 'Gói 80 tờ' : null, thumbnail: THUMB,
      flashPrice: 59_000 + i * 1_000, retailPrice: 100_000, salePrice: null, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
  mockHomeCombos(api, homeCombos());
}

async function shot(target: Page | Locator, name: string): Promise<void> {
  const dir = process.env.F10A_SHOTS;
  if (!dir) return;
  const out = join(dir, 'mini375');
  mkdirSync(out, { recursive: true });
  await target.screenshot({ path: join(out, `${name}.png`) });
}

/** Mọi ô meta có chữ: chữ nhìn thấy phải nằm trọn trong ô (ô meta nowrap + ellipsis nên bị cắt thì scrollWidth lớn hơn clientWidth). */
async function clippedMeta(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-ds-part="meta"]'))
      .filter((el) => (el.textContent ?? '').trim() !== '' && el.getBoundingClientRect().width > 0)
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => `${el.closest<HTMLElement>('[data-ds="product-tile"]')?.dataset.dsVariant ?? '?'}: "${Array.from(el.children).find((c) => getComputedStyle(c).display !== 'none')?.textContent ?? el.textContent}" ${el.scrollWidth}>${el.clientWidth}`),
  );
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Giờ vàng', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Bán chạy nhất', exact: true }).locator('[data-ds="product-tile"]')).toHaveCount(BEST.length, { timeout: 15_000 });
  await expect(page.getByTestId('home-combos')).toBeVisible({ timeout: 15_000 });
}

test.describe('Mini 375px: thẻ và hàng cuộn của Trang chủ', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Trang chủ có Giờ vàng, Bán chạy, Combo, Mua lại: trang không tràn ngang', async ({ page, api }) => {
    mockHome(api);
    await openHome(page);
    await shot(page.getByRole('region', { name: 'Giờ vàng', exact: true }), 'home-flash');
    await shot(page.getByTestId('home-combos'), 'home-combos');
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
      return { page: scroller ? scroller.scrollWidth - scroller.clientWidth : 0, doc: document.documentElement.scrollWidth - 375 };
    });
    expect(overflow.page, 'Trang chủ tràn ngang').toBeLessThanOrEqual(0);
    expect(overflow.doc, 'tài liệu tràn ngang').toBeLessThanOrEqual(0);
  });

  test('thẻ Giờ vàng: tên một dòng dù tên dài có dấu, mọi thẻ cùng kệ cao bằng nhau', async ({ page, api }) => {
    mockHome(api);
    await openHome(page);
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
    test(`${width}px: dòng meta của kệ Bán chạy nhất, Mua lại và lưới Gợi ý không bị cắt giữa số`, async ({ page, api }) => {
      mockHome(api);
      await page.setViewportSize({ width, height: 812 });
      await openHome(page);
      const best = page.getByRole('region', { name: 'Bán chạy nhất', exact: true });
      await best.scrollIntoViewIfNeeded();
      await shot(best, `home-best-${width}`);
      await page.getByRole('region', { name: 'Gợi ý hôm nay' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' }).locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
      expect(await clippedMeta(page)).toEqual([]);
    });
  }
});

test.describe('Mini 375px: ghi chú Giờ vàng ở /flash-sale', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('con số giới hạn đứng trước tên phân loại và hiện đủ', async ({ page, api }) => {
    mockDiscovery(api);
    mockFlashSlots(api, { items: { [SLOT_LIVE.id]: [liveItem(1, { variationName: 'Gói 80 tờ', perUserLimit: 2 }), liveItem(2, { variationName: 'Gói 80 tờ', perUserLimit: 2 })] } });
    await page.goto('/flash-sale');
    const notes = page.locator('[data-ds-part="note"]');
    await expect(notes).toHaveCount(2, { timeout: 15_000 });
    await shot(page, 'flash-sale');
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
