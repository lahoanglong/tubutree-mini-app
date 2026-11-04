import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { multiVariationProduct } from './support/pdp-product';
import { anchorBelow, gate, readShiftBelow, trackLayoutShift } from './support/pdp-cls';
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
const IN_CART_2 = 'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.';
const MERGE_2 = 'Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.';
const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

interface Priced {
  slug: string;
  variations: { id: string; name: string; retailPrice: number; salePrice: number | null; stock: number }[];
}

async function pricedProduct(request: APIRequestContext, slug: string): Promise<Priced | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as Priced) : null;
}

/** Đăng nhập giả: cờ phiên trong trình duyệt, làm mới phiên và hồ sơ qua mock. */
async function mockSignedIn(page: Page, api: MockApi, holdRefresh?: Promise<void>): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', async () => {
    await holdRefresh;
    return { accessToken: 'e2e-token', user };
  });
  api.get('/me', () => user);
  api.get('/me/coupons', []);
  api.allowUnmocked('GET /affiliate/me', 'GET /products/:slug/reviews/can-review');
}

/** Đăng nhập giả và giỏ đã có `quantity` sản phẩm của phân loại `variationId`: thêm giỏ cộng dồn và máy chủ giá cả dòng. */
async function mockCartWith(page: Page, api: MockApi, p: Priced, variationId: string, quantity: number): Promise<void> {
  await mockSignedIn(page, api);
  const v = p.variations.find((x) => x.id === variationId)!;
  const unit = v.salePrice ?? v.retailPrice;
  api.get('/cart', {
    items: [{ id: 'ci-1', variationId, slug: p.slug, productName: 'Sản phẩm thử', variationName: v.name, thumbnail: null, unitPrice: unit, quantity, stock: 50, weight: 600, total: unit * quantity }],
    couponCode: null, subtotal: unit * quantity, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: quantity,
  });
}

type PdpOpts = {
  inCart?: number;
  /** Đăng nhập giả, `perUserLeft` của suất `fi-1` ở các đơn trước (giỏ rỗng); `delayMs` cho số về muộn. */
  allowance?: { perUserLeft: number; delayMs?: number; hold?: Promise<void> };
  /** Treo POST /auth/refresh cho tới khi test mở: phiên còn đang khôi phục. */
  holdRefresh?: Promise<void>;
  viewport?: { width: number; height: number };
};

async function openPdp(page: Page, api: MockApi, p: Priced, flashIndex: number, opts: PdpOpts = {}): Promise<void> {
  const flashVariation = p.variations[flashIndex]!;
  if (opts.inCart) await mockCartWith(page, api, p, flashVariation.id, opts.inCart);
  if (opts.allowance) {
    const { perUserLeft, delayMs, hold } = opts.allowance;
    if (!opts.inCart) {
      await mockSignedIn(page, api, opts.holdRefresh);
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    }
    api.get('/flash-sales/me/allowance', async () => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      await hold;
      return { items: { 'fi-1': { perUserLeft, allowance: Math.min(perUserLeft, 90) } } };
    });
  }
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
  await page.setViewportSize(opts.viewport ?? { width: 375, height: 812 });
  await page.goto(`/san-pham/${p.slug}`);
}

test.describe('Web khổ điện thoại: giá Giờ vàng ở nút mua và bảng chọn phân loại', () => {
  async function setup(page: Page, api: MockApi, request: APIRequestContext, opts: PdpOpts = {}) {
    const base = await multiVariationProduct(request);
    test.skip(!base, 'DB e2e chưa có sản phẩm nào từ 2 phân loại');
    const p = await pricedProduct(request, base!.slug);
    test.skip(!p || p.variations.length < 2, 'không đọc được giá phân loại từ API');
    const flashIndex = 0;
    const standing = p!.variations[flashIndex]!.salePrice ?? p!.variations[flashIndex]!.retailPrice;
    test.skip(standing <= FLASH_PRICE, 'giá phân loại thử không cao hơn giá Giờ vàng giả');
    await openPdp(page, api, p!, flashIndex, opts);
    return { p: p!, standing };
  }

  test('thanh dưới và ô Số lượng ngoài bảng: qty = giới hạn ghi 3 × giá Giờ vàng, qty 5 ghi cả dòng giá thường kèm ghi chú', async ({ page, api, request }) => {
    const { standing } = await setup(page, api, request);
    const plus = page.locator('[data-section="pdp-quantity"]').getByRole('button', { name: 'Tăng số lượng' });
    const buy = page.getByRole('button', { name: /^Mua ngay / });
    await expect(page.locator('[data-section="pdp-variation-chips"] button').first()).toContainText('Giờ vàng');
    await expectChipMetrics(page.locator('[data-section="pdp-variation-chips"] button').first());
    await plus.click();
    await plus.click();
    await expect(buy).toHaveAccessibleName(`Mua ngay ${vnd(LIMIT * FLASH_PRICE)}`);
    await expect(page.locator('[data-section="pdp-flash-limit"]')).toHaveText('');
    await plus.click();
    await plus.click();
    await expect(buy).toHaveAccessibleName(`Mua ngay ${vnd(5 * standing)}`);
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

  test('giỏ đã có 2 sản phẩm Giờ vàng (giới hạn 3): "Mua ngay" ghi cả dòng, "Thêm vào giỏ" ghi giỏ tăng, ghi chú nói theo giỏ, ô Số lượng không nhảy', async ({ page, api, request }) => {
    const { standing } = await setup(page, api, request, { inCart: 2 });
    await page.getByRole('button', { name: /^Mua ngay / }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible();
    const buy = dialog.getByRole('button', { name: /^Mua ngay · / });
    const plus = dialog.getByRole('button', { name: 'Tăng số lượng' });
    // Giỏ 2 + chọn 1 = 3 = giới hạn: cả dòng còn giá Giờ vàng.
    await expect(buy).toHaveText(`Mua ngay · ${vnd(3 * FLASH_PRICE)}`);
    await expect(dialog.getByRole('status')).toHaveText(MERGE_2);
    // Bảng còn đang trượt lên lúc vừa mở: hover chờ nó đứng yên rồi mới đo vị trí.
    await plus.hover();
    const before = (await plus.boundingBox())!;
    await plus.click();
    await expect(buy).toHaveText(`Mua ngay · ${vnd(4 * standing)}`);
    await expect(dialog.getByRole('status')).toHaveText(IN_CART_2);
    const after = (await plus.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Đóng' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
    const addDialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await addDialog.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(addDialog.getByRole('button', { name: /^Thêm vào giỏ · / })).toHaveText(`Thêm vào giỏ · ${vnd(4 * standing - 2 * FLASH_PRICE)}`);
  });
  test('khách đã dùng hết suất Giờ vàng ở đơn trước (perUserLeft 0): nút, bảng và ghi chú ghi giá thường, chỉ một request cho cả lần đổi số lượng', async ({ page, api, request }) => {
    const { standing } = await setup(page, api, request, { allowance: { perUserLeft: 0 } });
    const buy = page.getByRole('button', { name: /^Mua ngay / });
    await expect(buy).toHaveAccessibleName(`Mua ngay ${vnd(standing)}`);
    await expect(page.locator('[data-section="pdp-flash-limit"]')).toHaveText(SPENT);
    await page.locator('[data-section="pdp-quantity"]').getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(buy).toHaveAccessibleName(`Mua ngay ${vnd(2 * standing)}`);
    expect(api.callsTo('GET', '/flash-sales/me/allowance')).toHaveLength(1);

    await buy.click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog.getByRole('button', { name: /^Mua ngay · / })).toHaveText(`Mua ngay · ${vnd(2 * standing)}`);
    await expect(dialog.getByRole('status')).toHaveText(SPENT);
  });

  test('số về muộn (request chậm 2 giây): bảng đã mở, ô Số lượng không nhảy khi nút đổi sang giá thường và ghi chú hiện', async ({ page, api, request }) => {
    const { standing } = await setup(page, api, request, { allowance: { perUserLeft: 0, delayMs: 2_000 } });
    await page.getByRole('button', { name: /^Mua ngay · / }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    const buy = dialog.getByRole('button', { name: /^Mua ngay · / });
    const plus = dialog.getByRole('button', { name: 'Tăng số lượng' });
    await expect(buy).toHaveText(`Mua ngay · ${vnd(FLASH_PRICE)}`);
    await plus.hover();
    const before = (await plus.boundingBox())!;
    await expect(buy).toHaveText(`Mua ngay · ${vnd(standing)}`, { timeout: 10_000 });
    await expect(dialog.getByRole('status')).toHaveText(SPENT);
    const after = (await plus.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });
  for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    test(`${viewport.width}px, ngoài bảng: allowance còn treo rồi mới về, khối bên dưới giữ nguyên chỗ, CLS từ vùng ghi chú trở xuống bằng 0`, async ({ page, api, request }) => {
      await trackLayoutShift(page);
      const g = gate();
      await setup(page, api, request, { allowance: { perUserLeft: 0, hold: g.wait }, viewport });
      const slot = page.locator('[data-section="pdp-flash-limit"]');
      await expect(page.locator('[data-section="pdp-variation-chips"] button').first()).toContainText('Giờ vàng');
      const anchor = await anchorBelow(slot);
      await expect(slot).toHaveText('');
      const gap = async () => (await anchor.boundingBox())!.y - (await slot.boundingBox())!.y;
      const before = await gap();
      const clsBefore = await readShiftBelow(page, slot);
      g.release();
      await expect(slot).toHaveText(SPENT, { timeout: 10_000 });
      await page.waitForTimeout(300);
      const after = await gap();
      expect(Math.abs(after - before), `khối bên dưới dịch ${after - before}px so với vùng ghi chú`).toBeLessThanOrEqual(1);
      const cls = (await readShiftBelow(page, slot)) - clsBefore;
      expect(cls, `CLS khi ghi chú hiện ${cls.toFixed(4)}`).toBe(0);
    });

    test(`${viewport.width}px: phiên về sau khi trang đã vẽ (còn suất, không có ghi chú) không chèn dải mới đẩy phần bên dưới`, async ({ page, api, request }) => {
      await trackLayoutShift(page);
      const g = gate();
      await setup(page, api, request, { allowance: { perUserLeft: 3 }, holdRefresh: g.wait, viewport });
      const slot = page.locator('[data-section="pdp-flash-limit"]');
      await expect(page.locator('[data-section="pdp-variation-chips"] button').first()).toContainText('Giờ vàng');
      const anchor = await anchorBelow(slot);
      const gap = async () => (await anchor.boundingBox())!.y - (await slot.boundingBox())!.y;
      const before = await gap();
      const clsBefore = await readShiftBelow(page, slot);
      g.release();
      await expect(page.getByRole('button', { name: 'Tăng số lượng' }).first()).toBeVisible();
      await expect.poll(() => api.callsTo('GET', '/flash-sales/me/allowance').length, { timeout: 10_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(500);
      const after = await gap();
      expect(Math.abs(after - before), `khối bên dưới dịch ${after - before}px so với vùng ghi chú`).toBeLessThanOrEqual(1);
      const cls = (await readShiftBelow(page, slot)) - clsBefore;
      expect(cls, `CLS khi phiên về ${cls.toFixed(4)}`).toBe(0);
    });
  }

  test('không có Giờ vàng hoặc chưa đăng nhập: vùng ghi chú không giữ dải trống', async ({ page, api, request }) => {
    // Giờ vàng đang chạy nhưng khách chưa đăng nhập: không có số theo khách để chờ nên không giữ chỗ.
    await setup(page, api, request);
    const slot = page.locator('[data-section="pdp-flash-limit"]');
    await expect(page.locator('[data-section="pdp-variation-chips"] button').first()).toContainText('Giờ vàng');
    expect((await slot.boundingBox())?.height ?? 0).toBe(0);
  });
});
