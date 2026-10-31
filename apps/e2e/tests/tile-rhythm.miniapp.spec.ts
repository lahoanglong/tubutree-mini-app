import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { THUMB } from './support/buy-flow-mocks';
import { mockDiscovery } from './support/discovery-mocks';
import type { PageResponse, ProductCard } from '../../miniapp/src/services/shop-api';

/**
 * Mini App 375px — thẻ sản phẩm cùng nhịp (gói P4). Dữ liệu cố ý lệch nhau: tên dài có dấu "Ẩ"/"Ổ" (cắt 2 dòng), tên ngắn (1 dòng), thiếu ảnh,
 * thiếu sao và đã bán, hết hàng, có giá giảm (giá gạch). Dù vậy, trong mỗi hàng hai thẻ thì đáy hàng giá và chiều cao thẻ phải bằng nhau,
 * và dòng meta luôn một dòng. API mock toàn bộ, không waitForTimeout.
 */
const card = (id: string, name: string, over: Partial<ProductCard> = {}): ProductCard => ({
  id, slug: `sp-${id}`, name, brand: 'Tubu', thumbnail: THUMB, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true,
  ratingAvg: 4.5, reviewCount: 12, sold: 340, ...over,
});

const FIXTURE: ProductCard[] = [
  card('1', 'Ẩm Ổn Định Dầu Gội Thảo Mộc Bồ Kết Hương Sả Chanh Nguyên Chất Dung Tích Lớn Cho Cả Gia Đình'),
  card('2', 'Xà phòng', { reviewCount: 0, ratingAvg: undefined, sold: undefined }),
  card('3', 'Nước rửa chén sinh học hương chanh sả', { thumbnail: null, basePrice: 150_000, salePrice: 120_000 }),
  card('4', 'Túi vải', { inStock: false, reviewCount: 3, sold: 12 }),
  card('5', 'Bình giữ nhiệt inox 500ml họa tiết lá', { brand: 'Một Nhãn Hiệu Có Tên Rất Dài Để Thử Cắt Chữ', sold: 1234 }),
  card('6', 'Kem chống nắng', { isFeatured: true, thumbnail: null, reviewCount: 0, ratingAvg: undefined, sold: undefined }),
  card('7', 'Ống hút tre', { basePrice: 12_345_000, salePrice: 9_999_000 }),
  card('8', 'Giấy gói quà tái chế khổ lớn dùng cho mọi dịp lễ trong năm', { sold: 12 }),
];

function mockFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return [FIXTURE[0]!, FIXTURE[2]!, FIXTURE[4]!].map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10, quota: 50,
      endAt: new Date(now + 3 * 3_600_000).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

function mockRhythm(api: MockApi): void {
  mockDiscovery(api);
  // Đăng ký SAU mockDiscovery để thắng mặc định.
  api.get('/products', (): PageResponse<ProductCard> => ({ data: FIXTURE, meta: { page: 1, limit: 20, total: FIXTURE.length } }));
}

interface RowMetrics {
  cards: number;
  heights: number[];
  priceBottoms: number[];
  metaHeights: number[];
  names: string[];
}

/** Gom thẻ trong lưới theo hàng (cùng `top`) và đo trong trang, để mọi số lấy từ cùng một khung hình. */
async function rowsOf(grid: Locator): Promise<RowMetrics[]> {
  return grid.evaluate((el) => {
    const byTop = new Map<number, HTMLElement[]>();
    for (const li of Array.from(el.querySelectorAll<HTMLElement>(':scope > li'))) {
      const tile = li.querySelector<HTMLElement>('[data-ds="product-tile"]')!;
      const top = Math.round(tile.getBoundingClientRect().top);
      byTop.set(top, [...(byTop.get(top) ?? []), tile]);
    }
    return Array.from(byTop.values()).map((tiles) => ({
      cards: tiles.length,
      heights: tiles.map((t) => t.getBoundingClientRect().height),
      priceBottoms: tiles.map((t) => t.querySelector('[data-ds-part="price"]')!.getBoundingClientRect().bottom),
      metaHeights: tiles.map((t) => t.querySelector('[data-ds-part="meta"]')!.getBoundingClientRect().height),
      names: tiles.map((t) => t.querySelector('.tubu-tile-link')!.getAttribute('aria-label') ?? ''),
    }));
  });
}

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

function expectRhythm(rows: RowMetrics[]): void {
  expect(rows.length).toBeGreaterThanOrEqual(3);
  for (const row of rows) {
    expect(row.cards, `hàng ${row.names.join(' | ')}`).toBe(2);
    expect(spread(row.heights), `chiều cao thẻ hàng ${row.names.join(' | ')}`).toBeLessThanOrEqual(1);
    expect(spread(row.priceBottoms), `đáy hàng giá ${row.names.join(' | ')}`).toBeLessThanOrEqual(1);
    for (const h of row.metaHeights) expect(h, `meta ${row.names.join(' | ')}`).toBeLessThanOrEqual(16);
  }
}

async function settled(page: Page, grid: Locator): Promise<void> {
  await expect(grid.locator('[data-ds="product-tile"]')).toHaveCount(FIXTURE.length, { timeout: 15_000 });
  await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0);
}

test.describe('Thẻ sản phẩm cùng nhịp ở 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Danh mục: mọi hàng hai thẻ chênh đáy giá và chiều cao ≤ 1px dù tên, ảnh, sao, giá lệch nhau', async ({ page, api }) => {
    mockRhythm(api);
    await page.goto('/browse');
    const grid = page.getByTestId('catalog-grid');
    await settled(page, grid);
    expectRhythm(await rowsOf(grid));
  });

  test('Trang chủ, khối Gợi ý cho bạn: cùng nhịp như Danh mục', async ({ page, api }) => {
    mockRhythm(api);
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Gợi ý cho bạn' });
    await section.scrollIntoViewIfNeeded();
    const grid = section.getByTestId('catalog-grid');
    await settled(page, grid);
    expectRhythm(await rowsOf(grid));
  });

  test('thẻ cao đúng số đo chung: mỗi biến thể grid dùng chiều cao thân thẻ có nhãn hiệu, không nhảy khi dữ liệu về', async ({ page, api }) => {
    mockRhythm(api);
    await page.goto('/browse');
    const grid = page.getByTestId('catalog-grid');
    await settled(page, grid);
    const bodies = await grid.locator('[data-ds-part="body"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(bodies, 'chiều cao thân từng thẻ').toEqual(bodies.map(() => bodies[0]));
  });
});

test.describe('Nhãn Giờ vàng trên ảnh không chui dưới nút tim', () => {
  for (const width of [320, 360, 375, 390]) {
    test(`${width}px: mép phải nhãn nằm trước nút tim ở lưới và kệ Bán chạy`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      mockRhythm(api);
      mockFlash(api);
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Sản phẩm bán chạy' }).locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('region', { name: 'Gợi ý cho bạn' }).scrollIntoViewIfNeeded();
      await settled(page, page.getByRole('region', { name: 'Gợi ý cho bạn' }).getByTestId('catalog-grid'));
      const checks = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-ds="product-tile"]'))
          .map((t) => {
            const badge = t.querySelector<HTMLElement>('[data-ds-part="image-badge"]');
            const disc = t.querySelector<HTMLElement>('button[aria-label^="Yêu thích"] > span');
            if (!badge || !disc) return null;
            const label = Array.from(badge.querySelectorAll<HTMLElement>('.tubu-badge-long, .tubu-badge-short')).find((e) => getComputedStyle(e).display !== 'none');
            return { variant: t.dataset.dsVariant ?? '', shown: label?.textContent ?? badge.textContent ?? '', gap: disc.getBoundingClientRect().left - badge.getBoundingClientRect().right };
          })
          .filter((c): c is { variant: string; shown: string; gap: number } => c !== null),
      );
      expect(checks.length).toBeGreaterThanOrEqual(2);
      expect(checks.some((c) => c.variant === 'rail-md')).toBe(true);
      for (const c of checks) expect(c.gap, `${c.variant} "${c.shown}" ở ${width}px`).toBeGreaterThanOrEqual(0);
    });
  }
});
