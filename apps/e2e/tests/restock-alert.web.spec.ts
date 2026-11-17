import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { assertProductOnCi, firstProduct, multiVariationProduct, type PdpProduct } from './support/pdp-product';

/**
 * Trang sản phẩm web 360px (wave tubu-notify-cap-restock): phân loại đang chọn hết hàng thì nút chính của thanh dính là "Báo tôi khi có hàng"
 * khi cờ catalog.restock_alert_enabled bật (bấm lại để huỷ), cờ tắt giữ nút xám "Tạm hết hàng". Khách chưa đăng nhập bấm thì sang đăng nhập
 * với đường quay lại; quay lại có phiên thì đăng ký nốt đúng một lần. Phần server của Next gọi API thật (sản phẩm có sẵn trong DB e2e); tồn
 * kho trình duyệt hỏi lại và mọi lời gọi khác đi qua mock, nên mọi phân loại được mock thành hết hàng.
 * RESTOCK_SHOTS=<thư mục> thì chụp ảnh 360px.
 */
const VP = { width: 360, height: 780 } as const;
const SHOTS = process.env.RESTOCK_SHOTS;
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350_000, itemCount: 0 };

function mockOutOfStockPdp(
  api: MockApi,
  p: PdpProduct,
  opts: { enabled: boolean; authed: boolean; outIds?: readonly string[] },
): { subscribed: Set<string> } {
  const state = { subscribed: new Set<string>() };
  const out = (id: string) => !opts.outIds || opts.outIds.includes(id);
  if (opts.authed) mockSession(api, makeUser({ id: 'u-restock', fullName: 'Nguyễn Văn An' }));
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations.map((v) => ({ ...v, stock: out(v.id) ? 0 : Math.max(v.stock, 5) })) });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get('/me/coupons', []);
  api.get('/cart', EMPTY_CART);
  api.get('/restock-alerts', () => ({ enabled: opts.enabled, variationIds: opts.enabled && opts.authed ? [...state.subscribed] : [] }));
  api.post('/me/restock-alerts', ({ call }) => {
    const { variationId } = call.body as { variationId: string };
    state.subscribed.add(variationId);
    return { variationId, subscribed: true };
  });
  api.delete('/me/restock-alerts/:variationId', ({ params }) => {
    const variationId = params.variationId ?? '';
    state.subscribed.delete(variationId);
    return { variationId, subscribed: false };
  });
  api.allowUnmocked(
    'POST /events',
    'GET /affiliate/me',
    'GET /products/:slug/reviews/can-review',
    'GET /products/:slug/bundles',
    'GET /products/:slug/stock',
    'GET /products/:slug/compare',
  );
  return state;
}

async function openPdp(page: Page, slug: string, init?: { session?: boolean; pendingVariationId?: string }): Promise<void> {
  await page.addInitScript(
    (arg) => {
      try {
        if (arg.session) localStorage.setItem('tubu_web_session', '1');
        if (arg.pending && !sessionStorage.getItem('e2e_pending_seeded')) {
          sessionStorage.setItem('tubu_pending_restock', JSON.stringify({ variationId: arg.pending, at: Date.now() }));
          sessionStorage.setItem('e2e_pending_seeded', '1');
        }
      } catch {
        // không có storage: trang vẫn dựng
      }
    },
    { session: !!init?.session, pending: init?.pendingVariationId ?? null },
  );
  await page.setViewportSize(VP);
  await page.goto(`/san-pham/${slug}`);
  await expect(page.locator('[data-pdp-block="main"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

const stickyBar = (page: Page) => page.getByTestId('sticky-bar');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

let product: PdpProduct | null = null;
let multi: PdpProduct | null = null;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ 360px, chỉ chạy ở một project');
});

test.beforeAll(async ({ request }) => {
  product = await firstProduct(request);
  assertProductOnCi(product, 'sản phẩm bất kỳ');
  multi = await multiVariationProduct(request);
  assertProductOnCi(multi, 'sản phẩm từ 2 phân loại');
});

test('cờ tắt: phân loại hết hàng giữ nút xám "Tạm hết hàng", không có nút báo hàng về', async ({ page, api }) => {
  test.skip(!product, 'DB e2e chưa có sản phẩm');
  mockOutOfStockPdp(api, product!, { enabled: false, authed: true });
  await openPdp(page, product!.slug, { session: true });
  const grey = stickyBar(page).getByRole('button', { name: 'Tạm hết hàng' });
  await expect(grey).toBeVisible({ timeout: 30_000 });
  await expect(grey).toBeDisabled();
  await expect(page.getByTestId('pdp-restock')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-360-pdp-out-flag-off.png` });
});

test('cờ bật, đã đăng nhập: một nút chính "Báo tôi khi có hàng", bấm đăng ký rồi bấm lại huỷ', async ({ page, api }) => {
  test.skip(!product, 'DB e2e chưa có sản phẩm');
  const state = mockOutOfStockPdp(api, product!, { enabled: true, authed: true });
  await openPdp(page, product!.slug, { session: true });

  const button = stickyBar(page).getByTestId('pdp-restock');
  await expect(button).toHaveText('Báo tôi khi có hàng', { timeout: 30_000 });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(stickyBar(page).getByRole('button', { name: 'Tạm hết hàng' })).toHaveCount(0);
  await expect(stickyBar(page).getByTestId('pdp-add-to-cart')).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  const box = await button.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(44);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-360-pdp-out-flag-on.png` });

  const sub = api.waitForCall('POST', '/me/restock-alerts');
  await button.click();
  const subscribedId = ((await sub).body as { variationId: string }).variationId;
  expect(product!.variations.map((v) => v.id)).toContain(subscribedId);
  await expect(button).toHaveText('Đã đăng ký báo hàng · Huỷ');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(state.subscribed.has(subscribedId)).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-360-pdp-out-subscribed.png` });

  const unsub = api.waitForCall('DELETE', '/me/restock-alerts/:variationId');
  await button.click();
  expect((await unsub).path).toBe(`/me/restock-alerts/${subscribedId}`);
  await expect(button).toHaveText('Báo tôi khi có hàng');
  expect(state.subscribed.size).toBe(0);
});

test('cờ bật, chưa đăng nhập: bấm thì sang đăng nhập kèm đường quay lại và nhớ phân loại, chưa ghi gì', async ({ page, api }) => {
  test.skip(!product, 'DB e2e chưa có sản phẩm');
  mockOutOfStockPdp(api, product!, { enabled: true, authed: false });
  await openPdp(page, product!.slug);

  const button = stickyBar(page).getByTestId('pdp-restock');
  await expect(button).toHaveText('Báo tôi khi có hàng', { timeout: 30_000 });
  await button.click();
  await page.waitForURL(/\/dang-nhap/, { timeout: 15_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get('returnTo')).toBe(`/san-pham/${product!.slug}`);
  const pending = await page.evaluate(() => sessionStorage.getItem('tubu_pending_restock'));
  expect(product!.variations.map((v) => v.id)).toContain((JSON.parse(pending ?? '{}') as { variationId?: string }).variationId);
  expect(api.callsTo('POST', '/me/restock-alerts')).toHaveLength(0);
});

test('quay lại sau đăng nhập: đăng ký nốt phân loại đã bấm đúng một lần, nút thành "Đã đăng ký"', async ({ page, api }) => {
  test.skip(!product, 'DB e2e chưa có sản phẩm');
  const target = product!.variations[0]!.id;
  mockOutOfStockPdp(api, product!, { enabled: true, authed: true });
  await openPdp(page, product!.slug, { session: true, pendingVariationId: target });

  const button = stickyBar(page).getByTestId('pdp-restock');
  await expect(button).toHaveText('Đã đăng ký báo hàng · Huỷ', { timeout: 30_000 });
  await expect.poll(() => api.callsTo('POST', '/me/restock-alerts').length).toBe(1);
  expect((api.callsTo('POST', '/me/restock-alerts')[0]!.body as { variationId: string }).variationId).toBe(target);
  expect(await page.evaluate(() => sessionStorage.getItem('tubu_pending_restock'))).toBeNull();
  await page.waitForTimeout(500);
  expect(api.callsTo('POST', '/me/restock-alerts')).toHaveLength(1);
});

test('cờ bật: chip phân loại hết hàng chọn được, chọn nó thì nút chính thành "Báo tôi khi có hàng" và đăng ký đúng phân loại đó', async ({ page, api }) => {
  test.skip(!multi, 'DB e2e chưa có sản phẩm từ 2 phân loại');
  const target = multi!.variations[0]!.id;
  mockOutOfStockPdp(api, multi!, { enabled: true, authed: true, outIds: [target] });
  await openPdp(page, multi!.slug, { session: true });

  const chip = page.locator('[data-section="pdp-variation-chips"]').getByRole('button').nth(0);
  await expect(chip).toBeEnabled({ timeout: 30_000 });
  await chip.click();
  const button = stickyBar(page).getByTestId('pdp-restock');
  await expect(button).toHaveText('Báo tôi khi có hàng');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-360-pdp-mixed-out-chip.png` });
  const sub = api.waitForCall('POST', '/me/restock-alerts');
  await button.click();
  expect(((await sub).body as { variationId: string }).variationId).toBe(target);
});

test('cờ tắt: chip phân loại hết hàng vẫn khoá như trước', async ({ page, api }) => {
  test.skip(!multi, 'DB e2e chưa có sản phẩm từ 2 phân loại');
  const target = multi!.variations[0]!.id;
  mockOutOfStockPdp(api, multi!, { enabled: false, authed: true, outIds: [target] });
  await openPdp(page, multi!.slug, { session: true });
  await expect(stickyBar(page).getByTestId('pdp-add-to-cart')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-section="pdp-variation-chips"]').getByRole('button').nth(0)).toBeDisabled();
});
