import type { Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';
import { APPLY_CODE, APPLY_DISCOUNT, mockVoucherHint, type HintWallet } from './support/cart-voucher-hint-mocks';

/**
 * W44B + W166, web khách ở 320/375/393px và 1440×900: gợi ý mã giảm giá ở Giỏ (/gio-hang). Giỏ là trang client nên mọi dữ liệu đi qua mock,
 * không cần seed. Giỏ có một dòng 90.000đ: GIAM20 đủ điều kiện (giảm 20.000đ), GIAM80 đòi đơn tối thiểu 120.000đ nên còn thiếu 30.000đ
 * (thanh đạt 75%). Từ W166 chỉ MỘT nút áp mã, như Mini App: "Áp dụng" ở cuối hàng "Mã giảm giá" (thanh dính dưới md, khung tóm tắt từ md), thay "Chọn mã ›";
 * dải dưới thanh Miễn phí giao hàng chỉ còn dòng nhắc mã sắp mở khoá. Khổ do spec tự đặt, chỉ chạy ở project Web Customer Mobile. Không đặt đơn thật.
 */
const SIZES = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
  { width: 1440, height: 900 },
] as const;

const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const USER = {
  id: 'u-w44b-cart', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

function mockCart(api: MockApi, o: { wallet?: HintWallet; couponCode?: string; applyError?: string } = {}): void {
  let applied: string | null = o.couponCode ?? null;
  const cart = () => ({
    items: [
      {
        id: 'l0', variationId: 'v0', productName: 'Serum dưỡng ẩm', variationName: 'Mặc định', slug: 'serum', thumbnail: null,
        unitPrice: 90_000, quantity: 1, stock: 9, total: 90_000, fulfiller: TUBU,
      },
    ],
    couponCode: applied, subtotal: 90_000, discount: applied ? APPLY_DISCOUNT : 0, freeship: false, freeshipThreshold: 500_000, itemCount: 1,
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', USER);
  api.get('/auth/me', { ...USER, ownsBrand: false });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 0, pointsConvertedBalance: 0 });
  api.get('/cart', cart);
  mockVoucherHint(api, o.wallet ?? 'both');
  api.post('/cart/coupon', ({ call }) => {
    if (o.applyError) return reply(400, { statusCode: 400, message: o.applyError });
    applied = (call.body as { code: string }).code;
    return cart();
  });
  api.get('/products', { data: [], meta: { page: 1, limit: 10, total: 0 } });
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// tubu-w47-01: giỏ chỉ có MỘT thanh mốc; mã GIAM80 còn thiếu 30.000đ gần hơn mốc Miễn phí giao hàng nên chính thanh `freeship-progress` nói mã.
const strip = (page: Page) => page.locator('[data-testid="freeship-progress"][data-goal="voucher"]');
const cta = (page: Page) => page.getByTestId('cart-voucher-apply-cta');
const couponRow = (page: Page) => page.getByTestId('coupon-row');
/** Dưới md hàng mã nằm trong thanh dính; từ md nằm trong khung tóm tắt. */
const rowHost = (page: Page, width: number) => page.getByTestId(width < 768 ? 'sticky-bar' : 'cart-summary');

async function openCart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  await page.goto('/gio-hang');
  await expect(page.getByTestId('freeship-progress')).toBeVisible({ timeout: 20_000 });
}

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: Giỏ — gợi ý mã giảm giá`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize(size);
    });

    test('mã đủ điều kiện chỉ có MỘT nút "Áp dụng" ở hàng mã; dải thân giỏ là thanh mốc duy nhất nhắc mã sắp mở khoá, trên "Chọn tất cả", nút từ 44px, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);
      await expect(strip(page)).toBeVisible();

      await expect(page.getByTestId('cart-voucher-apply')).toHaveCount(0);
      await expect(strip(page)).not.toContainText('Bạn có mã giảm giá');
      await expect(page.getByTestId('cart-voucher-unlock')).toContainText('🔥 Mua thêm 30.000đ để mở khoá mã giảm giá 80.000đ');
      const bar = page.getByTestId('cart-voucher-unlock-bar');
      await expect(bar).toHaveAttribute('role', 'progressbar');
      await expect(bar).toHaveAttribute('aria-valuenow', '75');
      await expect(bar).toHaveAttribute('aria-label', 'Đã đạt 75% đơn tối thiểu của mã giảm giá');
      await expect(cta(page)).toHaveCount(1);
      await expect(cta(page)).toHaveAccessibleName(`Áp dụng ngay mã ${APPLY_CODE}`);
      await expect(cta(page)).toHaveText('Áp dụng');
      await expect(rowHost(page, size.width).getByTestId('cart-voucher-apply-cta')).toHaveCount(1);
      await expect(page.getByTestId('coupon-cta')).toHaveCount(0);
      expect(await cta(page).evaluate((el) => !!el.closest('[data-testid="coupon-row"]'))).toBe(false);

      await expect(page.getByTestId('cart-voucher-hint'), 'không còn dải nhắc mã riêng dưới thanh').toHaveCount(0);
      await expect(page.getByTestId('freeship-progress'), 'một thanh mốc duy nhất').toHaveCount(1);
      const box = (await strip(page).boundingBox())!;
      const selectAll = (await page.getByLabel('Chọn tất cả sản phẩm').locator('xpath=ancestor::label').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(selectAll.y + 1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);

      const b = (await cta(page).boundingBox())!;
      expect(b.width, 'chiều rộng nút Áp dụng').toBeGreaterThanOrEqual(44);
      expect(b.height, 'chiều cao nút Áp dụng').toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('một chạm "Áp dụng": gửi đúng một lệnh áp mã GIAM20, nút và dải gợi ý biến mất vì giỏ đã có mã, hàng mã ghi mã, lời "Đã áp dụng mã GIAM20" hiện cho trình đọc màn hình', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);
      await expect(cta(page)).toBeVisible();

      const applying = api.waitForCall('POST', '/cart/coupon');
      await cta(page).click();
      expect((await applying).body).toEqual({ code: APPLY_CODE });

      await expect(strip(page)).toHaveCount(0);
      await expect(cta(page)).toHaveCount(0);
      await expect(rowHost(page, size.width)).toContainText(APPLY_CODE);
      await expect(page.getByTestId('cart-voucher-applied')).toHaveText(`Đã áp dụng mã ${APPLY_CODE}`);
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('bấm chữ của hàng mã (không phải nút "Áp dụng") mở danh sách chọn mã và KHÔNG gửi lệnh áp mã', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);
      await expect(cta(page)).toBeVisible();
      await couponRow(page).click();
      if (size.width < 768) await expect(page.getByRole('dialog')).toBeVisible();
      else await expect(couponRow(page)).toHaveAttribute('aria-expanded', 'true');
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('áp không được: lời báo của máy chủ hiện ngay dưới hàng mã (role=alert) và gắn với nút, dải nhắc mở khoá còn nguyên, nút bấm lại được', async ({ page, api }) => {
      mockCart(api, { applyError: 'Mã giảm giá đã hết lượt dùng.' });
      await openCart(page);

      await cta(page).click();
      const alert = page.getByTestId('cart-voucher-error');
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert).toHaveText('Mã giảm giá đã hết lượt dùng.');
      await expect(strip(page)).toBeVisible();
      await expect(cta(page)).toBeEnabled();
      await expect(cta(page)).not.toHaveAttribute('aria-busy', 'true');
      await expect(cta(page)).toHaveAttribute('aria-describedby', (await alert.getAttribute('id'))!);
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
      const a = (await alert.boundingBox())!;
      const row = (await couponRow(page).boundingBox())!;
      expect(a.y, 'lời báo nằm dưới hàng mã').toBeGreaterThanOrEqual(row.y + row.height - 1);
      await expect(rowHost(page, size.width).getByTestId('cart-voucher-error')).toHaveCount(1);
      expect(a.x + a.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('ví chỉ có mã còn thiếu: chỉ dòng nhắc mở khoá, có đúng một nút "Mua thêm" từ 44px, hàng mã giữ "Chọn mã" (không có nút "Áp dụng") và không tràn ngang', async ({ page, api }) => {
      mockCart(api, { wallet: 'unlock' });
      await openCart(page);
      await expect(page.getByTestId('cart-voucher-unlock')).toBeVisible();
      await expect(page.getByTestId('cart-voucher-apply')).toHaveCount(0);
      await expect(cta(page)).toHaveCount(0);
      await expect(page.getByTestId('coupon-cta')).toContainText('Chọn mã');
      const buttons = strip(page).getByRole('button');
      await expect(buttons).toHaveCount(1);
      await expect(buttons).toHaveText('Mua thêm');
      const b = (await page.getByTestId('freeship-shop-more-cta').boundingBox())!;
      expect(b.width, 'chiều rộng nút Mua thêm').toBeGreaterThanOrEqual(44);
      expect(b.height, 'chiều cao nút Mua thêm').toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('giỏ đã có mã: không vẽ dải gợi ý và không hỏi xem trước từng mã', async ({ page, api }) => {
      mockCart(api, { couponCode: 'DACO' });
      await openCart(page);
      await page.waitForTimeout(800);
      await expect(strip(page)).toHaveCount(0);
      expect(api.callsTo('POST', '/checkout/coupon-previews')).toHaveLength(0);
    });

    test('giảm chuyển động: thanh mở khoá không đổi bề rộng bằng transition, vẫn không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openCart(page);
      await expect(page.getByTestId('cart-voucher-unlock-bar')).toBeVisible();
      const transition = await page.getByTestId('cart-voucher-unlock-bar').locator('.tubu-freeship-fill').evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(transition).toBe('0s');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
