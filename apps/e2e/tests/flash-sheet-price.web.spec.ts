import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { multiVariationProduct } from './support/pdp-product';
import { expectChipMetrics } from './support/variation-chip';

/**
 * Web khổ 375px, trang sản phẩm: mua quá giới hạn Giờ vàng mỗi khách thì máy chủ tính CẢ dòng giá thường (flash-line-price.ts), nên các nút mua và
 * bảng chọn phân loại phải ghi đúng số đó, giống Mini App (flash-sheet-price.miniapp.spec.ts). Phần server của Next gọi API thật nên spec lấy sản phẩm
 * từ 2 phân loại trong DB e2e và tự bỏ qua khi chưa có; mọi lời gọi từ trình duyệt đi qua mock. Giá Giờ vàng đặt 1.000đ để chắc chắn rẻ hơn giá bán.
 */

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const HOUR = 3_600_000;
const FLASH_PRICE = 1_000;
const LIMIT = 3;
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

interface Priced {
  slug: string;
  variations: { id: string; name: string; retailPrice: number; salePrice: number | null; stock: number }[];
}

async function pricedProduct(request: APIRequestContext, slug: string): Promise<Priced | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as Priced) : null;
}

async function openPdp(page: Page, api: MockApi, p: Priced, flashIndex: number): Promise<void> {
  const flashVariation = p.variations[flashIndex]!;
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return [
      {
        itemId: 'fi-1', variationId: flashVariation.id, productSlug: p.slug, productName: 'Sản phẩm thử', variationName: flashVariation.name, thumbnail: null,
        flashPrice: FLASH_PRICE, retailPrice: flashVariation.retailPrice, salePrice: flashVariation.salePrice, soldCount: 1, quota: 1000, perUserLimit: LIMIT,
        endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
      },
    ];
  });
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  // Tồn kho thật: phân loại cuối hết hàng (chip "Tạm hết hàng"), còn lại đủ để mua 5.
  api.get(`/products/${p.slug}`, { variations: p.variations.map((v, i) => ({ id: v.id, stock: i === p.variations.length - 1 ? 0 : 50 })) });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/san-pham/${p.slug}`);
}

test.describe('Web khổ điện thoại: giá Giờ vàng ở nút mua và bảng chọn phân loại', () => {
  async function setup(page: Page, api: MockApi, request: APIRequestContext) {
    const base = await multiVariationProduct(request);
    test.skip(!base, 'DB e2e chưa có sản phẩm nào từ 2 phân loại');
    const p = await pricedProduct(request, base!.slug);
    test.skip(!p || p.variations.length < 2, 'không đọc được giá phân loại từ API');
    const flashIndex = 0;
    const standing = p!.variations[flashIndex]!.salePrice ?? p!.variations[flashIndex]!.retailPrice;
    test.skip(standing <= FLASH_PRICE, 'giá phân loại thử không cao hơn giá Giờ vàng giả');
    await openPdp(page, api, p!, flashIndex);
    return { p: p!, standing };
  }

  test('thanh dưới và ô Số lượng ngoài bảng: qty = giới hạn ghi 3 × giá Giờ vàng, qty 5 ghi cả dòng giá thường kèm ghi chú', async ({ page, api, request }) => {
    const { standing } = await setup(page, api, request);
    const plus = page.locator('[data-section="pdp-quantity"]').getByRole('button', { name: 'Tăng số lượng' });
    const buy = page.getByRole('button', { name: /^Mua ngay · / });
    await expect(page.locator('[data-section="pdp-variation-chips"] button').first()).toContainText('Giờ vàng');
    await expectChipMetrics(page.locator('[data-section="pdp-variation-chips"] button').first());
    await plus.click();
    await plus.click();
    await expect(buy).toHaveAccessibleName(`Mua ngay · ${vnd(LIMIT * FLASH_PRICE)}`);
    await expect(page.locator('[data-section="pdp-flash-limit"]')).toHaveText('');
    await plus.click();
    await plus.click();
    await expect(buy).toHaveAccessibleName(`Mua ngay · ${vnd(5 * standing)}`);
    await expect(page.locator('[data-section="pdp-flash-limit"]')).toHaveText(`Giá Giờ vàng tối đa ${LIMIT} sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.`);
  });

  test('bảng chọn phân loại: nhãn Giờ vàng + Tối đa 3/khách, nút ghi đúng số khi vượt, ô Số lượng không nhảy khi ghi chú hiện, chip hết hàng ghi "Tạm hết hàng"', async ({ page, api, request }) => {
    const { p, standing } = await setup(page, api, request);
    await page.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('variation-sheet-flash')).toContainText('Giờ vàng');
    await expect(dialog.getByTestId('variation-sheet-flash')).toContainText(`Tối đa ${LIMIT}/khách`);
    await expectChipMetrics(dialog.getByRole('group', { name: 'Phân loại' }).getByRole('button').first());
    const outChip = dialog.getByRole('button', { name: new RegExp(p.variations[p.variations.length - 1]!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    await expect(outChip).toBeDisabled();
    await expect(outChip).toContainText('Tạm hết hàng');

    const add = dialog.getByRole('button', { name: /^Thêm vào giỏ · / });
    const plus = dialog.getByRole('button', { name: 'Tăng số lượng' });
    await plus.click();
    await plus.click();
    await expect(add).toHaveText(`Thêm vào giỏ · ${vnd(LIMIT * FLASH_PRICE)}`);
    const before = (await plus.boundingBox())!;
    await plus.click();
    await expect(add).toHaveText(`Thêm vào giỏ · ${vnd(4 * standing)}`);
    await expect(dialog.getByRole('status')).toContainText('Mua 4 thì cả dòng tính giá thường');
    const after = (await plus.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await plus.click();
    await expect(add).toHaveText(`Thêm vào giỏ · ${vnd(5 * standing)}`);
  });
});
