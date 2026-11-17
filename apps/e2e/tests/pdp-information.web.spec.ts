import type { Page } from '@playwright/test';
import { PDP_BLOCK_ORDER } from '../../../packages/app-core/src/commerce/pdp-info';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { assertProductOnCi, multiVariationProduct, type PdpProduct } from './support/pdp-product';

/**
 * Trang sản phẩm web (wave tubu-pdp-information) ở 390px và 1440px: khối theo thứ tự `PDP_BLOCK_ORDER` (chung với Mini App), không tràn
 * ngang, CLS ≤ 0,1; điện thoại bấm chip còn hàng rồi "Thêm vào giỏ" là một chạm (không mở bảng chọn). Phần server của Next gọi API thật
 * (sản phẩm nhiều phân loại có sẵn trong DB e2e); mọi lời gọi từ trình duyệt đi qua mock.
 */
const SIZES = [
  { name: 'web390', width: 390, height: 844 },
  { name: 'web1440', width: 1440, height: 900 },
] as const;

const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350_000, itemCount: 0 };

function mockPdp(api: MockApi, p: PdpProduct): void {
  mockSession(api, makeUser({ id: 'u-pdp-info', fullName: 'Nguyễn Văn An' }));
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/me/allowance', { items: {} });
  api.get('/config/public', { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get('/me/coupons', []);
  api.get('/cart', EMPTY_CART);
  api.post('/cart/items', EMPTY_CART);
  api.allowUnmocked(
    'POST /events',
    'GET /affiliate/me',
    'GET /products/:slug/reviews/can-review',
    'GET /products/:slug/bundles',
    'GET /products/:slug/stock',
    'GET /products/:slug/compare',
  );
}

async function openPdp(page: Page, slug: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: trang vẫn dựng
    }
  });
  await page.goto(`/san-pham/${slug}`);
  await expect(page.locator('[data-pdp-block="main"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
}

/** Khối đang hiện kèm toạ độ đỉnh trên trang. */
const visibleBlocks = (page: Page) =>
  page.locator('[data-pdp-block]').evaluateAll((els) =>
    els
      .filter((e) => e.getClientRects().length > 0 && (e as HTMLElement).offsetHeight > 0)
      .map((e) => ({ key: e.getAttribute('data-pdp-block')!, top: Math.round(e.getBoundingClientRect().top + window.scrollY) })),
  );

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

let product: PdpProduct | null = null;

// Mỗi ca tự đặt khổ màn: chỉ chạy ở một project web khách.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
});

test.beforeAll(async ({ request }) => {
  product = await multiVariationProduct(request);
  assertProductOnCi(product, 'sản phẩm từ 2 phân loại');
});

for (const vp of SIZES) {
  test(`PDP ${vp.name}: khối theo thứ tự chung, không tràn ngang, CLS ≤ 0,1`, async ({ page, api }) => {
    test.skip(!product, 'DB e2e chưa có sản phẩm từ 2 phân loại');
    const p = product!;
    mockPdp(api, p);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await observeCls(page);
    await openPdp(page, p.slug);

    const blocks = await visibleBlocks(page);
    const keys = blocks.map((b) => b.key);
    for (const k of ['gallery', 'main', 'description'] as const) expect(keys, `có khối ${k}`).toContain(k);
    expect(new Set(keys).size, `khối trùng: ${keys.join(',')}`).toBe(keys.length);
    // Điện thoại một cột: thứ tự DOM phải là thứ tự nhìn thấy. Máy tính: ảnh và cột mua nằm ngang nhau, nên chỉ so phần dưới cột mua.
    if (vp.width < 768) {
      const tops = blocks.map((b) => b.top);
      expect(tops, `khối xếp chồng theo thứ tự ${keys.join(',')}`).toEqual([...tops].sort((a, b) => a - b));
    }
    const checked = vp.width < 768 ? keys : keys.filter((k) => PDP_BLOCK_ORDER.indexOf(k as never) >= PDP_BLOCK_ORDER.indexOf('ingredients'));
    expect(checked, 'thứ tự khối').toEqual(PDP_BLOCK_ORDER.filter((k) => checked.includes(k)));

    expect(await noHorizontalScroll(page)).toBe(true);
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(800);
    const { cls, sources } = await readClsTotal(page);
    test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
    expect(cls, `CLS ${sources.join(' ; ')}`).toBeLessThanOrEqual(0.1);
    if (process.env.PDP_SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${process.env.PDP_SHOTS}/web-pdp-${vp.width}-full.jpg`, type: 'jpeg', quality: 60, fullPage: true });
    }
  });
}

test('PDP 390px: bấm chip còn hàng rồi Thêm vào giỏ là một chạm, đúng phân loại, không mở bảng chọn', async ({ page, api }) => {
  test.skip(!product, 'DB e2e chưa có sản phẩm từ 2 phân loại');
  const p = product!;
  const target = [...p.variations].reverse().find((v) => v.stock > 0);
  test.skip(!target, 'sản phẩm không có phân loại còn hàng');
  mockPdp(api, p);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPdp(page, p.slug);

  const chips = page.locator('[data-section="pdp-variation-chips"]');
  await expect(chips).toBeVisible();
  const index = p.variations.findIndex((v) => v.id === target!.id);
  await chips.getByRole('button').nth(index).click();

  const add = page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart');
  await expect(add).toBeEnabled({ timeout: 30_000 });
  const before = api.callsTo('POST', '/cart/items').length;
  await add.click();
  await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(before + 1);
  const body = api.callsTo('POST', '/cart/items').at(-1)!.body as { variationId: string };
  expect(body.variationId).toBe(target!.id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('PDP 390px: chưa bấm chip thì Thêm vào giỏ mở bảng chọn phân loại', async ({ page, api }) => {
  test.skip(!product, 'DB e2e chưa có sản phẩm từ 2 phân loại');
  const p = product!;
  mockPdp(api, p);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPdp(page, p.slug);
  const add = page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart');
  await expect(add).toBeEnabled({ timeout: 30_000 });
  const before = api.callsTo('POST', '/cart/items').length;
  await add.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(api.callsTo('POST', '/cart/items').length).toBe(before);
});
