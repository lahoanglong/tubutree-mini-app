import type { Page } from '@playwright/test';
import { PDP_BLOCK_ORDER } from '../../../packages/app-core/src/commerce/pdp-info';
import type { ProductCompare } from '../../../packages/app-core/src/api/product-compare';
import { test, expect, type MockApi } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Trang sản phẩm Mini App ở 360px (wave tubu-pdp-information): thứ tự khối theo `PDP_BLOCK_ORDER`, chọn chip rồi "Thêm vào giỏ" một chạm,
 * mô tả HTML không hiện thẻ dạng chữ, đánh giá rỗng một dòng, dòng Mua lại, bảng So sánh, CLS và không tràn ngang. API mock toàn bộ.
 */
const VP = { width: 360, height: 740 } as const;

const VARIATIONS = [
  { id: 'var-5l', sku: 'NRC-5L', name: '5L', attributes: {}, retailPrice: 320_000, salePrice: null, stock: 8 },
  { id: 'var-2l', sku: 'NRC-2L', name: '2L', attributes: {}, retailPrice: 150_000, salePrice: null, stock: 12 },
  { id: 'var-1l', sku: 'NRC-1L', name: '1L', attributes: {}, retailPrice: 85_000, salePrice: null, stock: 20 },
];

const PRODUCT = {
  ...PILOT_PRODUCT,
  shortDesc: 'Sạch dầu mỡ, an toàn cho da tay',
  description: '<p>Nước rửa chén <strong>sinh học</strong> chiết xuất chanh gừng.</p><ul><li>Không chất tạo bọt SLS</li><li>Phân huỷ sinh học</li></ul><script>alert(1)</script>',
  ingredients: [
    { name: 'Chiết xuất chanh', benefit: 'Đánh bay dầu mỡ' },
    { name: 'Gừng', benefit: 'Khử mùi tanh' },
    { name: 'Muối biển' },
    { name: 'Enzyme' },
    { name: 'Nước tinh khiết' },
  ],
  certifications: ['Không SLS'],
  variations: VARIATIONS,
  fulfiller: { kind: 'TUBU' },
};

const COMPARE: ProductCompare = {
  current: { productId: PILOT_PRODUCT.id, slug: PILOT_SLUG, name: PILOT_PRODUCT.name, brand: 'Tubu', thumbnail: null, price: 85_000, variationName: '1L', size: '1L', unitPrice: { per: '100ml', value: 8_500 }, keyIngredients: ['Chiết xuất chanh', 'Gừng'] },
  others: [
    { productId: 'p-a', slug: 'nuoc-rua-chen-a', name: 'Nước rửa chén A 3,8L', brand: 'Fuwa3e', thumbnail: null, price: 385_000, variationName: '3.8L', size: '3,8L', unitPrice: { per: '100ml', value: 10_132 }, keyIngredients: ['Dứa'] },
    { productId: 'p-b', slug: 'nuoc-rua-chen-b', name: 'Nước rửa chén B 500ml', brand: 'Visante', thumbnail: null, price: 95_000, variationName: '500ml', size: '500ml', unitPrice: null, keyIngredients: [] },
  ],
};

const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 };

// Gói Refill đã ghép với chai 500ml 65.000đ: 10L 890.000đ = 20 chai (1.300.000đ), tiết kiệm 410.000đ (~31%).
const REFILL_OFFER = {
  productId: 'p-refill', slug: 'tui-refill-nuoc-rua-chen-10l', name: 'Túi Refill nước rửa chén 10L', thumbnail: null, variationId: 'var-refill',
  price: 890_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true,
};

function mockPdp(api: MockApi, opts: { compare?: boolean; purchased?: boolean; refill?: boolean } = {}): void {
  mockPilotProduct(api);
  api.get('/products/:slug', PRODUCT);
  api.get('/cart', EMPTY_CART);
  api.get('/config/public', { freeshipThreshold: 200_000, returnWindowDays: 7, subscribeDiscountPct: 0.12, ...(opts.refill ? { refillFirstEnabled: true } : {}) });
  if (opts.refill) api.get('/catalog/refill-pairs', { [PILOT_PRODUCT.id]: REFILL_OFFER });
  api.get('/products/:slug/reviews/can-review', { canReview: false, reason: 'NOT_PURCHASED', rewardAvailable: false, purchaseCount: 0, reviewableOrders: [], myReviews: [] });
  if (opts.compare) api.get('/products/:slug/compare', COMPARE);
  if (opts.purchased) {
    api.get('/me/purchased-items', {
      items: [
        {
          variationId: 'var-2l', productId: PILOT_PRODUCT.id, slug: PILOT_SLUG, productName: PILOT_PRODUCT.name, variationName: '2L', brand: 'Tubu', thumbnail: null,
          price: 150_000, salePrice: null, stock: 12, inStock: true, timesBought: 1, lastPurchasedAt: '2026-11-03T03:00:00.000Z', retailOnly: false, flashPrice: null, flashAllowance: null,
        },
      ],
      nextCursor: null,
    });
  }
}

async function openPdp(page: Page): Promise<void> {
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

const blockOrder = (page: Page) =>
  page.locator('[data-pdp-block]').evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('data-pdp-block')!));

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Mini App cuộn trong khung trang (overflow-y auto), không cuộn `window`: đặt vị trí cuộn của khung cao nhất, trả chiều cao cuộn được. */
const scrollPageTo = (page: Page, top: number) =>
  page.evaluate((y) => {
    const scrollers = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    });
    const main = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!main) {
      window.scrollTo(0, y);
      return document.documentElement.scrollHeight - window.innerHeight;
    }
    main.scrollTo(0, y);
    return main.scrollHeight - main.clientHeight;
  }, top);

test.describe('Mini App 360px: trang sản phẩm sắp lại thông tin', () => {
  test.use({ viewport: VP });

  test('thứ tự khối đúng danh sách, không tràn ngang, CLS ≤ 0,1', async ({ page, api }) => {
    mockPdp(api, { compare: true, purchased: true });
    await observeCls(page);
    await openPdp(page);
    await expect(page.locator('[data-pdp-block="compare"]')).toBeVisible();
    await expect(page.locator('[data-pdp-block="rebuy"]')).toBeVisible();

    const order = await blockOrder(page);
    const expected = PDP_BLOCK_ORDER.filter((k) => order.includes(k));
    expect(order, 'thứ tự khối').toEqual(expected);
    for (const k of ['gallery', 'main', 'variations', 'rebuy', 'shipping', 'benefits', 'ingredients', 'description', 'reviews', 'compare', 'promises'] as const) {
      expect(order, `có khối ${k}`).toContain(k);
    }
    expect(order, 'câu chuyện chỉ khi có cấu hình riêng').not.toContain('story');

    expect(await noHorizontalScroll(page)).toBe(true);
    // WebKit di động không có mouse.wheel: cuộn khung trang từng nấc để các khối dưới (đánh giá, so sánh, gợi ý) dựng và đo dịch chuyển của chúng.
    for (let y = 600; y <= 6000; y += 600) {
      await scrollPageTo(page, y);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(600);
    const { cls, sources } = await readClsTotal(page);
    expect(cls, `CLS ${sources.join(' ; ')}`).toBeLessThanOrEqual(0.1);
    if (process.env.PDP_SHOTS) {
      // Chụp từng màn (khung trang cuộn bên trong nên ảnh fullPage chỉ có màn đầu).
      const step = VP.height - 160;
      const max = await scrollPageTo(page, 0);
      for (let i = 0, y = 0; y <= max + step - 1 && i < 8; i += 1, y += step) {
        await scrollPageTo(page, y);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${process.env.PDP_SHOTS}/mini-pdp-360-s${i}.jpg`, type: 'jpeg', quality: 65 });
      }
    }
  });

  test('chọn chip rồi Thêm vào giỏ: một chạm, không mở bảng chọn, đúng phân loại', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);
    const chips = page.getByRole('group', { name: 'Phân loại nhanh' });
    await chips.getByRole('button', { name: /2L/ }).click();
    const before = api.callsTo('POST', '/cart/items').length;
    await page.getByRole('button', { name: 'Thêm vào giỏ' }).click();
    await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(before + 1);
    const body = api.callsTo('POST', '/cart/items').at(-1)!.body as { variationId: string; quantity: number };
    expect(body.variationId).toBe('var-2l');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('chưa chọn chip: Thêm vào giỏ mở bảng chọn phân loại', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);
    const before = api.callsTo('POST', '/cart/items').length;
    await page.getByRole('button', { name: 'Thêm vào giỏ' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(api.callsTo('POST', '/cart/items').length).toBe(before);
  });

  test('mô tả HTML có định dạng, không thẻ dạng chữ; Thành phần là dòng gập, chạm mở đủ danh sách; đánh giá rỗng một dòng', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);
    const desc = page.locator('[data-pdp-block="description"]');
    await desc.scrollIntoViewIfNeeded();
    await expect(desc).toContainText('sinh học');
    const descText = await desc.innerText();
    expect(descText).not.toMatch(/<\/?(p|ul|li|strong|script)/);
    expect(descText).not.toContain('alert');

    // tubu-w47-01: Thành phần là dòng gập 48px trong "Chi tiết sản phẩm" (gợi ý số thành phần), thân gập vẫn có trong DOM.
    const ing = page.locator('[data-pdp-block="ingredients"]');
    const toggle = ing.getByTestId('pdp-ingredients-toggle');
    const body = ing.locator('.tubu-pdp-detail-body');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('5 thành phần');
    await expect(body).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    await expect(body).toContainText('Chiết xuất chanh');
    await expect(body).toContainText('Nước tinh khiết');

    const reviews = page.locator('[data-pdp-block="reviews"]');
    await reviews.scrollIntoViewIfNeeded();
    await expect(reviews).toContainText('Chưa có đánh giá');
    const box = (await reviews.boundingBox())!;
    expect(box.height, 'khối đánh giá rỗng không chiếm nửa màn').toBeLessThan(140);
  });

  test('dòng Mua lại: một chạm thêm đúng phân loại lần trước, số lượng 1', async ({ page, api }) => {
    mockPdp(api, { purchased: true });
    await openPdp(page);
    const row = page.locator('[data-pdp-block="rebuy"]');
    await expect(row).toContainText('Bạn đã mua ngày 03/11');
    const before = api.callsTo('POST', '/cart/items').length;
    await row.getByRole('button').click();
    await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(before + 1);
    const body = api.callsTo('POST', '/cart/items').at(-1)!.body as { variationId: string; quantity: number };
    expect(body).toMatchObject({ variationId: 'var-2l', quantity: 1 });
  });

  test('cờ So sánh tắt (404): không có khối, không báo lỗi', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);
    await expect(page.locator('[data-pdp-block="reviews"]')).toBeVisible();
    await expect(page.locator('[data-pdp-block="compare"]')).toHaveCount(0);
  });
});

test.describe('Mini App: thẻ gói Refill ở trang chai (tubu-w13-01)', () => {
  for (const width of [320, 375, 393]) {
    test(`${width}px: dải cách mua ngay sau dòng Mua lại, chọn "Túi Refill" thì có một thẻ: số tiết kiệm và số chai, vùng chạm 44px, số đều, không tràn ngang; "+ Thêm" thêm đúng gói`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      mockPdp(api, { purchased: true, refill: true });
      await openPdp(page);
      // tubu-w47-01: thẻ gói Refill chỉ hiện ở chế độ "Túi Refill" của dải cách mua (Mua lẻ là mặc định).
      const modes = page.getByTestId('pdp-buy-modes');
      await expect(modes).toBeVisible();
      await expect(page.getByTestId('pdp-refill')).toHaveCount(0);
      await modes.locator('[data-mode="refill"]').click();
      await expect(modes.locator('[data-mode="refill"]')).toHaveAttribute('aria-pressed', 'true');
      const card = modes.getByTestId('pdp-buy-mode-detail').getByTestId('pdp-refill');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('Chọn túi Refill 10L tiết kiệm 410.000đ (~31%)');
      await expect(card).toContainText('Thay thế 20 chai nhựa · 890.000đ');
      await expect(card.getByRole('button')).toHaveCount(2);
      const order = await blockOrder(page);
      expect(order.indexOf('modes'), 'dải cách mua ngay sau dòng Mua lại').toBe(order.indexOf('rebuy') + 1);

      const add = card.getByTestId('pdp-refill-add');
      await add.scrollIntoViewIfNeeded();
      const addBox = (await add.boundingBox())!;
      expect(Math.min(addBox.width, addBox.height), 'nút "+ Thêm" tối thiểu 44×44').toBeGreaterThanOrEqual(44);
      const openBox = (await card.getByTestId('pdp-refill-open').boundingBox())!;
      expect(openBox.height, 'vùng mở trang gói cao từ 44px').toBeGreaterThanOrEqual(44);
      expect(await card.locator('.tubu-refill-offer-card').evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
      expect(await card.evaluate((el) => el.getBoundingClientRect().right), 'thẻ nằm trọn trong khổ').toBeLessThanOrEqual(width);
      expect(await noHorizontalScroll(page)).toBe(true);

      const before = api.callsTo('POST', '/cart/items').length;
      await add.click();
      await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(before + 1);
      expect(api.callsTo('POST', '/cart/items').at(-1)!.body).toMatchObject({ variationId: 'var-refill', quantity: 1 });
    });
  }

  test('375px: chạm phần chữ mở trang gói Refill', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    mockPdp(api, { refill: true });
    await openPdp(page);
    await page.getByTestId('pdp-buy-modes').locator('[data-mode="refill"]').click();
    await page.getByTestId('pdp-refill-open').click();
    await expect(page).toHaveURL(/\/product\/tui-refill-nuoc-rua-chen-10l$/);
  });

  test('cờ Refill tắt: không hỏi cặp, không có thẻ', async ({ page, api }) => {
    mockPdp(api, { purchased: true });
    await openPdp(page);
    await expect(page.locator('[data-pdp-block="rebuy"]')).toBeVisible();
    await expect(page.getByTestId('pdp-refill')).toHaveCount(0);
    expect(api.callsTo('GET', '/catalog/refill-pairs')).toHaveLength(0);
  });
});
