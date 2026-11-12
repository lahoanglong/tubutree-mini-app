import type { Page } from '@playwright/test';
import { test as plain, expect as plainExpect } from '@playwright/test';
import { test, expect, makeOrder, makeUser, mockSession, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';
import { STATES, mockWorld } from './support/checkout-states';
import { probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';
import { probeFixedOverlap, probeFocusRing, probeImageSizes, probeUnnamedControls } from './support/narrow-audit';
import { observeCls, readClsTotal } from './support/cls-observer';
import { firstProduct, multiVariationProduct } from './support/pdp-product';

/**
 * W130: kiểm khổ 320×720 và 360×800 trên các trang khách của web: / , /san-pham, /san-pham/:slug, /gio-hang, /thanh-toan, /tai-khoan/don-hang.
 * Mỗi trang không tràn ngang, không điều khiển nào có vùng chạm dưới 44px (cả header và thanh dưới), mọi điều khiển có tên đọc được, hai phần tử cố định
 * không chồng nhau, ảnh khai báo `sizes` đúng khung, tiền và số đếm vẽ bằng số đều, CLS lúc tải bằng 0,00 (ngưỡng 0,001). Trang công khai chạy trên API thật (SSR cần dữ liệu thật),
 * trang sau đăng nhập mock mọi lời gọi từ trình duyệt.
 * W130_SHOT_DIR: đặt đường dẫn thư mục để ghi ảnh chụp từng trang.
 */
const SIZES = [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
] as const;

const CLS_MAX = 0.001;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Gom mọi phát hiện của một trang vào một mảng để lỗi in ra cả loạt thay vì dừng ở phát hiện đầu. */
async function audit(page: Page, label: string, opts: { focusSteps?: number } = {}): Promise<string[]> {
  await settle(page);
  const found: string[] = [];
  // CLS của lúc tải: đọc trước khi bộ dò cuộn trang (cuộn tới đáy kích hoạt nạp thêm lưới gợi ý, dịch chân trang là do cuộn chứ không do lúc tải).
  const { cls, sources } = await readClsTotal(page);
  if (process.env.W130_PRINT) console.log(`W130 CLS ${label}: ${cls.toFixed(4)}`);
  if (cls > CLS_MAX) found.push(`CLS ${cls.toFixed(3)} > ${CLS_MAX}: ${sources.slice(0, 3).join(' ; ')}`);
  // Số giảm trong hàng mã giữ số tỉ lệ: số đều rộng hơn vài px mà hàng mã ở 320px chỉ còn độ dư 12px (xem coupon-row-checkout-320, layout-narrow.web).
  const layout = await probeLayout(page, { ignoreNumeric: ['[data-testid="coupon-discount"]'] });
  found.push(...layout.overflow.map((m) => `tràn ngang: ${m}`), ...layout.notTabular.map((m) => `số không đều: ${m}`));
  found.push(...(await probeTapTargets(page)).map((m) => `vùng chạm: ${m}`));
  found.push(...(await probeUnnamedControls(page)).map((m) => `thiếu tên: ${m}`));
  found.push(...(await probeImageSizes(page)).map((m) => `ảnh: ${m}`));
  await page.evaluate(() => window.scrollTo(0, 0));
  found.push(...(await probeFixedOverlap(page)).map((m) => `chồng (đầu trang): ${m}`));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  found.push(...(await probeFixedOverlap(page)).map((m) => `chồng (cuối trang): ${m}`));
  await page.evaluate(() => window.scrollTo(0, 0));
  found.push(...(await probeFocusRing(page, opts.focusSteps ?? 25)).map((m) => `focus: ${m}`));
  if (process.env.W130_PRINT) console.log(`W130 ${label}\n  ${found.join('\n  ') || '(sạch)'}`);
  return found;
}

async function shot(page: Page, name: string, width: number, height: number): Promise<void> {
  const dir = process.env.W130_SHOT_DIR;
  if (!dir) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  // Ảnh trạng thái nghỉ: bỏ vòng focus còn sót từ lúc dò bàn phím (riêng ảnh `lookup` cần giữ focus ở ô tìm).
  if (name !== 'lookup') await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: `${dir}/tubutree-w130-${name}-${width}x${height}.png`, fullPage: false });
}

for (const { width, height } of SIZES) {
  plain.describe(`W130 web khách ${width}x${height}: trang công khai`, () => {
    plain.beforeEach(async ({ page }, testInfo) => {
      plain.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize({ width, height });
      await observeCls(page);
    });

    plain('Trang chủ', async ({ page }) => {
      await page.goto('/');
      const found = await audit(page, `/ ${width}`);
      await shot(page, 'home', width, height);
      plainExpect.soft(found, `Trang chủ ${width}px`).toEqual([]);
    });

    plain('Danh sách sản phẩm', async ({ page }) => {
      await page.goto('/san-pham?all=1');
      const found = await audit(page, `/san-pham ${width}`);
      await shot(page, 'browse', width, height);
      plainExpect.soft(found, `/san-pham ${width}px`).toEqual([]);
    });

    // Khách chưa đăng nhập: giỏ, Câu chuyện, Tư vấn (trang đăng nhập bắt buộc). Web không có ngăn kéo giỏ hay bong bóng tư vấn nổi: giỏ và tư vấn là trang riêng.
    for (const [name, path] of [
      ['Giỏ hàng (khách)', '/gio-hang'],
      ['Câu chuyện thương hiệu', '/cau-chuyen'],
      ['Tư vấn (khách)', '/tu-van'],
    ] as const) {
      plain(name, async ({ page }) => {
        await page.goto(path);
        await plainExpect(page.getByRole('main').first()).toBeVisible({ timeout: 30_000 });
        const found = await audit(page, `${path} ${width}`);
        await shot(page, path.slice(1).replace(/\W+/g, '-'), width, height);
        plainExpect.soft(found, `${name} ${width}px`).toEqual([]);
      });
    }

    plain('Chi tiết sản phẩm nhiều phân loại', async ({ page, request }) => {
      const product = (await multiVariationProduct(request)) ?? (await firstProduct(request));
      plain.skip(!product, 'DB e2e chưa có sản phẩm');
      await page.goto(`/san-pham/${product!.slug}`);
      const found = await audit(page, `/san-pham/:slug ${width}`);
      await shot(page, 'pdp', width, height);
      plainExpect.soft(found, `PDP ${width}px`).toEqual([]);
    });
  });
}

async function signIn(page: Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
}

for (const { width, height } of SIZES) {
  test.describe(`W130 web khách ${width}x${height}: trang sau đăng nhập`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize({ width, height });
      await observeCls(page);
    });

    test('Giỏ hàng', async ({ page, api }) => {
      await signIn(page, api);
      api.get('/config/public', { freeshipThreshold: 200_000, support: { hotline: '0984606774', email: 'tubutree@gmail.com' }, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } });
      const cart = footerCart({ lines: 3, reached: false, combo: 6_000, saving: 8_000, coupon: { code: 'TUBU10', discount: 15_000 }, deals: true });
      api.get('/cart', { ...cart, items: cart.items.map((l, i) => ({ ...l, weight: 600, ...(i === cart.items.length - 1 ? { quantity: 2, total: l.unitPrice * 2 } : null) })) });
      api.get('/flash-sales/active', []);
      api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
      await page.goto('/gio-hang');
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
      const found = await audit(page, `/gio-hang ${width}`);
      await shot(page, 'cart', width, height);
      expect.soft(found, `Giỏ hàng ${width}px`).toEqual([]);
    });

    test('Giỏ hàng trống', async ({ page, api }) => {
      await signIn(page, api);
      api.get('/config/public', { freeshipThreshold: 200_000 });
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 });
      api.allowUnmocked('GET /products', 'GET /flash-sales/active', 'GET /products/best-sellers');
      await page.goto('/gio-hang');
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
      const found = await audit(page, `/gio-hang trống ${width}`);
      await shot(page, 'cart-empty', width, height);
      expect.soft(found, `Giỏ trống ${width}px`).toEqual([]);
    });

    test('Thanh toán', async ({ page, api }) => {
      await mockWorld(api, page, 'web', STATES[0]!, Promise.resolve());
      await page.goto('/thanh-toan');
      await expect(page.getByRole('button', { name: /Đặt hàng/ }).last()).toBeVisible({ timeout: 30_000 });
      const found = await audit(page, `/thanh-toan ${width}`);
      await shot(page, 'checkout', width, height);
      expect.soft(found, `Thanh toán ${width}px`).toEqual([]);
    });

    test('Đơn hàng', async ({ page, api }) => {
      await signIn(page, api);
      api.get('/config/public', { freeshipThreshold: 500000 });
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 });
      api.get('/me/purchased-items', { items: [], nextCursor: null });
      api.get('/orders/me/refunds', []);
      const all = [
        makeOrder({ code: 'TUBU-W130-D', status: 'DELIVERED', paymentStatus: 'PAID', total: 1_249_000 }),
        makeOrder({ code: 'TUBU-W130-S', status: 'SHIPPING', total: 89_000 }),
      ];
      api.get('/orders', { data: all, meta: { page: 1, limit: 20, total: all.length } });
      api.allowUnmocked('GET /me/coupons', 'GET /me/addresses', 'GET /waste/me', 'GET /me/subscriptions', 'GET /affiliate/me', 'POST /events');
      await page.goto('/tai-khoan/don-hang');
      await expect(page.getByText('TUBU-W130-D').first()).toBeVisible({ timeout: 30_000 });
      const found = await audit(page, `/tai-khoan/don-hang ${width}`);
      await shot(page, 'orders', width, height);
      expect.soft(found, `Đơn hàng ${width}px`).toEqual([]);

      // Mã đơn dán từ Zalo (dấu cách hai đầu, ký tự vô hình U+200B) tới máy chủ phải đã sạch.
      const search = page.getByRole('searchbox', { name: /Tìm đơn/ });
      await search.fill(` TUBU-W130-D${String.fromCharCode(0x200b)}  `);
      await search.press('Enter');
      await expect.poll(() => api.callsTo('GET', '/orders').some((c) => c.query.get('q') === 'TUBU-W130-D'), { timeout: 15_000 }).toBe(true);
      await shot(page, 'lookup', width, height);
    });
  });
}
