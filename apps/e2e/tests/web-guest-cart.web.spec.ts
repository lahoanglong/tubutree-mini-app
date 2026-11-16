import type { APIRequestContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { assertProductOnCi, singleVariationProduct } from './support/pdp-product';
import { WEB_SIZES_GUARD } from './support/w182-audit';
import { probeW182 } from './support/w182-probe';

/**
 * Giỏ khách trên web (cờ `web.guest_cart_enabled`). Cờ bật: khách chưa đăng nhập thêm món ở trang sản phẩm mà không bị đưa sang đăng nhập,
 * mở giỏ thấy món với giá lấy lại từ API công khai và một nút "Đăng nhập để đặt hàng"; đăng nhập (giả lập callback Zalo) thì món chuyển vào
 * giỏ tài khoản bằng POST /cart/items và trang quay về giỏ. Cờ tắt: hành vi cũ (sang đăng nhập, giỏ là tường đăng nhập).
 * Phần server của Next gọi API thật (sản phẩm một phân loại có sẵn trong DB e2e); mọi lời gọi từ trình duyệt đi qua mock.
 * Có GUEST_CART_SHOTS_DIR thì chụp ảnh 360/390px trước (cờ tắt) và sau (cờ bật) vào thư mục đó.
 */

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const SHOTS_DIR = process.env.GUEST_CART_SHOTS_DIR;

interface Detail {
  slug: string;
  name: string;
  thumbnail: string | null;
  variations: { id: string; name: string; retailPrice: number; salePrice: number | null; stock: number }[];
}

async function fullDetail(request: APIRequestContext, slug: string): Promise<Detail | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as Detail) : null;
}

async function inStockProduct(request: APIRequestContext): Promise<Detail | null> {
  const p = await singleVariationProduct(request);
  assertProductOnCi(p, 'sản phẩm một phân loại');
  if (!p || (p.variations[0]?.stock ?? 0) <= 0) return null;
  return fullDetail(request, p.slug);
}

function mockGuestPdp(api: MockApi, d: Detail, flagOn: boolean): void {
  api.get('/config/public', { ...publicConfig(), freeshipThreshold: 199000, ...(flagOn ? { webGuestCartEnabled: true } : {}) });
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get(`/products/${d.slug}`, d);
  api.get(`/products/${d.slug}/related`, []);
  api.get(`/products/${d.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get(`/products/${d.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.allowUnmocked('GET /affiliate/me', 'GET /products/:slug/reviews/can-review', 'POST /coupons/preview', 'GET /coupons/available', 'POST /affiliate/touch', 'GET /me/wishlist/ids', 'GET /products');
}

/** Nút thêm giỏ đang hiện: thanh dính đáy ở điện thoại, khối mua ở máy tính. */
const visibleAdd = (page: Page) => page.locator('[data-testid="pdp-add-to-cart"]:visible').first();
const visibleLogin = (page: Page) => page.locator('[data-testid="guest-cart-login"]:visible').first();

function serverCartWith(d: Detail, quantity: number) {
  const v = d.variations[0]!;
  const unit = v.salePrice ?? v.retailPrice;
  return {
    items: [
      { id: 'line-guest-1', variationId: v.id, productName: d.name, variationName: v.name, slug: d.slug, thumbnail: d.thumbnail, unitPrice: unit, quantity, stock: v.stock, total: unit * quantity },
    ],
    couponCode: null,
    subtotal: unit * quantity,
    discount: 0,
    freeship: unit * quantity >= 199000,
    freeshipThreshold: 199000,
    itemCount: quantity,
  };
}

const EMPTY_SERVER_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 0 };

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.jpg`, type: 'jpeg', quality: 80, fullPage: true });
}

test.describe('Giỏ khách trên web, cờ bật', () => {
  test('trang sản phẩm → giỏ khách → đăng nhập → giỏ tài khoản có đủ món', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    const mobile = testInfo.project.name === 'Web Customer Mobile';
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    mockGuestPdp(api, d!, true);

    await page.goto(`/san-pham/${d!.slug}`);
    const add = visibleAdd(page);
    await expect(add).toBeEnabled({ timeout: 30_000 });
    await add.click();
    // Câu "Đã thêm vào giỏ!" nằm ở khối mua trên máy tính; ở điện thoại phản hồi là huy hiệu giỏ của thanh dính đáy.
    if (!mobile) await expect(page.getByText('Đã thêm vào giỏ!').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tubu.guestCart.v1')), { timeout: 10_000 }).not.toBeNull();
    expect(new URL(page.url()).pathname).toBe(`/san-pham/${d!.slug}`);
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
    const stored = await page.evaluate(() => localStorage.getItem('tubu.guestCart.v1'));
    expect(JSON.parse(stored ?? '[]')).toEqual([expect.objectContaining({ variationId: d!.variations[0]!.id, slug: d!.slug, quantity: 1 })]);
    expect(stored).not.toMatch(/price|Price/);

    await page.goto('/gio-hang');
    await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('cart-line').filter({ hasText: d!.name })).toBeVisible();
    const login = visibleLogin(page);
    await expect(login).toHaveText('Đăng nhập để đặt hàng');
    await expect(login).toHaveAttribute('href', '/dang-nhap?returnTo=%2Fgio-hang');
    // Chân trang có lối "Mã giảm giá"; giỏ khách thì không có ô mã.
    await expect(page.getByTestId('guest-cart').getByText('Mã giảm giá')).toHaveCount(0);
    if (mobile) await shoot(page, 'after-guest-cart-390');

    // Đăng nhập giả lập: trang callback nhận mã + state khớp, máy chủ trả tài khoản; giỏ tài khoản đang trống.
    const user = makeUser({ id: 'user-guest-cart' });
    mockSession(api, user);
    api.get('/config/public', { ...publicConfig(), freeshipThreshold: 199000, webGuestCartEnabled: true });
    api.post('/auth/zalo-oauth', { accessToken: 'e2e-token', refreshToken: '', user });
    let serverCart: object = EMPTY_SERVER_CART;
    api.get('/cart', () => serverCart);
    api.post('/cart/items', ({ call }) => {
      const body = call.body as { quantity: number };
      serverCart = serverCartWith(d!, body.quantity);
      return serverCart;
    });
    api.allowUnmocked('GET /me/coupons', 'GET /coupons/available', 'POST /coupons/preview', 'GET /flash-sales/me/allowance', 'GET /products/:slug/bought-together');
    await page.evaluate(() => {
      sessionStorage.setItem('tubu_oauth_state', 'e2e-state');
      sessionStorage.setItem('tubu_pkce_verifier', 'e2e-verifier');
      sessionStorage.setItem('tubu_return_to', '/');
    });
    const merged = api.waitForCall('POST', '/cart/items', 20_000);
    await page.goto('/dang-nhap/callback?code=e2e-code&state=e2e-state');
    const call = await merged;
    expect(call.body).toEqual({ variationId: d!.variations[0]!.id, quantity: 1 });
    await page.waitForURL('**/gio-hang', { timeout: 20_000 });
    await expect(page.getByTestId('guest-cart')).toHaveCount(0);
    await expect(page.getByTestId('cart-line').filter({ hasText: d!.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /^Thanh toán/ }).first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('tubu.guestCart.v1'))).toBeNull();
    expect(api.callsTo('POST', '/cart/items'), 'gộp đúng một lần').toHaveLength(1);
  });

  test('giỏ khách không tràn ngang, vùng chạm 44px, chữ không đè (320/375/768/1280)', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    mockGuestPdp(api, d!, true);
    const line = { variationId: d!.variations[0]!.id, slug: d!.slug, quantity: Math.min(2, d!.variations[0]!.stock), addedAt: 1 };
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('tubu.guestCart.v1', value);
      } catch {
        // không có localStorage: giỏ trống
      }
    }, JSON.stringify([line]));
    for (const size of WEB_SIZES_GUARD) {
      await page.setViewportSize(size);
      await page.goto('/gio-hang');
      await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('cart-line').first()).toHaveAttribute('data-state', 'ok');
      await page.waitForTimeout(500);
      const p = await probeW182(page, { touch: size.width <= 768, capsule: false });
      expect(p.overflowX, `${size.width}px tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      if (size.width <= 768) expect(p.small, `${size.width}px vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.textOverlap, `${size.width}px chữ đè nhau`).toEqual([]);
      expect(p.floating.filter((f) => f.overlaps.length > 0), `${size.width}px nút nổi đè nội dung`).toEqual([]);
    }
    if (SHOTS_DIR) {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto('/gio-hang');
      await expect(page.getByTestId('cart-line').first()).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
      await page.waitForTimeout(500);
      await shoot(page, 'after-guest-cart-360');
    }
  });
});

test.describe('Giỏ khách trên web, cờ tắt', () => {
  test('khách bấm Thêm vào giỏ thì sang đăng nhập; giỏ là tường đăng nhập như cũ', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    const mobile = testInfo.project.name === 'Web Customer Mobile';
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    mockGuestPdp(api, d!, false);
    api.allowUnmocked('GET /dang-nhap');

    await page.goto('/gio-hang');
    await expect(page.getByText('Đăng nhập để xem giỏ hàng của bạn.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('guest-cart')).toHaveCount(0);
    if (mobile && SHOTS_DIR) {
      await page.setViewportSize({ width: 360, height: 780 });
      await shoot(page, 'before-login-wall-360');
      await page.setViewportSize({ width: 390, height: 844 });
    }

    await page.goto(`/san-pham/${d!.slug}`);
    const add = visibleAdd(page);
    await expect(add).toBeEnabled({ timeout: 30_000 });
    await add.click();
    await page.waitForURL(/\/dang-nhap\?returnTo=/, { timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem('tubu.guestCart.v1'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('tubu_pending_add'))).toContain(d!.variations[0]!.id);
  });
});
