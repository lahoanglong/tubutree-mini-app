import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { footerCart, mockCouponHint, type FooterCartOptions } from './support/cart-footer-mocks';

/**
 * Chân dính của giỏ web khổ 375px phải là chân dính của Mini App (cart-footer.miniapp.spec.ts, review hình bước chốt, P1 #7): cao khoảng
 * 140px, tổng tiền và nút Thanh toán cùng một hàng, đã đạt miễn phí giao thì chỉ một dòng chữ, và chân trang cuối không bị chân dính che.
 * Trình duyệt mock toàn bộ API trong trình duyệt (cùng cách với cart-lines.web.spec.ts).
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

async function openCart(page: Page, api: MockApi, o: FooterCartOptions & { hint?: { usable: number; maxSaving: number } } = {}, size = { width: 375, height: 812 }) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', {
    freeshipThreshold: 200_000,
    support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
    waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
  });
  const cart = footerCart(o);
  api.get('/cart', { ...cart, items: cart.items.map((l) => ({ ...l, weight: 600 })) });
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
  if (o.hint) mockCouponHint(api, o.hint);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
  await expect(bar(page)).toBeVisible();
}

const bar = (page: Page) => page.getByTestId('sticky-bar');
const payButton = (page: Page) => bar(page).getByText(/^Thanh toán \(\d+\)$/);
const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
const barHeight = async (page: Page) => Math.round((await bar(page).boundingBox())!.height);

test.describe('Web khách: chân dính giỏ ở 375px', () => {
  test('đã đạt miễn phí giao, không giảm gì: cao ≤150px, một dòng chữ không thanh, tổng và nút cùng một hàng', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true });

    const h = await barHeight(page);
    expect(h, `chân dính cao ${h}px`).toBeLessThanOrEqual(150);
    await expect(bar(page).getByText('Bạn được miễn phí giao hàng')).toBeVisible();
    await expect(page.getByTestId('freeship-bar')).toHaveCount(0);

    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(Math.abs(mid(total) - mid(pay)), `tâm tổng ${Math.round(mid(total))}px, tâm nút ${Math.round(mid(pay))}px`).toBeLessThanOrEqual(12);
    expect(pay.x, 'nút nằm bên phải số tiền').toBeGreaterThanOrEqual(total.x + total.width);
    expect(pay.x + pay.width).toBeLessThanOrEqual(375);
  });

  test('chưa đạt miễn phí giao, có dòng giảm combo: vẫn có thanh tiến độ, cao ≤180px', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: false, combo: 6_000 });

    await expect(page.getByTestId('freeship-bar')).toHaveCount(1);
    await expect(bar(page).getByText('Giảm giá combo')).toBeVisible();
    const h = await barHeight(page);
    // Mini ≤175: thanh dính của web (dùng chung với Thanh toán, trang sản phẩm) có viền trên 1px và đệm 12px (Mini 10px) nên dôi ~5px.
    expect(h, `chân dính cao ${h}px`).toBeLessThanOrEqual(180);
    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(Math.abs(mid(total) - mid(pay))).toBeLessThanOrEqual(12);
  });

  test('giỏ 8 dòng có dòng hết hàng: cuộn hết thì chân trang nằm trên chân dính (không bị che)', async ({ page, api }) => {
    await openCart(page, api, { lines: 8, reached: true, outOfStock: true });
    await expect(bar(page).getByRole('alert')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(300);
    const top = (await bar(page).boundingBox())!.y;
    const end = await page.evaluate(() => {
      const f = document.querySelector('footer');
      return (f ?? document.body.lastElementChild!).getBoundingClientRect().bottom;
    });
    expect(end, `cuối trang ở ${Math.round(end)}px, chân dính bắt đầu ở ${Math.round(top)}px`).toBeLessThanOrEqual(top + 1);
    // Lời báo hết hàng làm chân cao thêm; trần này giữ để lời báo không phình chân thành nửa màn.
    expect(await barHeight(page)).toBeLessThanOrEqual(215);
  });

  for (const [usable, maxSaving, text] of [
    [6, 60_000, '6 mã · giảm đến 60k'],
    [9, 123_456, '9 mã · giảm đến 123.456đ'],
  ] as const) {
    test(`gợi ý ${usable} mã dùng được, mã tốt nhất giảm ${maxSaving}: hiện đủ "${text}" trên một dòng, không bị cắt "…" (P1 #8)`, async ({ page, api }) => {
      await openCart(page, api, { lines: 3, reached: true, hint: { usable, maxSaving } });

      const hint = bar(page).getByText(text, { exact: true });
      await expect(hint).toBeVisible();
      const fit = await hint.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fit.scroll, `chữ gợi ý cần ${fit.scroll}px, chỗ có ${fit.client}px`).toBeLessThanOrEqual(fit.client);
      // Số tròn nghìn (60k) vừa một dòng; số lẻ ghi đủ có thể xuống hai dòng nhưng hàng mã vẫn 44px và chân dính không cao thêm.
      const lines = Math.round((await hint.evaluate((el) => el.getBoundingClientRect().height)) / 16);
      expect(lines, `gợi ý chiếm ${lines} dòng`).toBeLessThanOrEqual(maxSaving % 1_000 === 0 ? 1 : 2);
      expect(await barHeight(page), 'hàng mã vẫn 44px nên chân dính không cao thêm').toBeLessThanOrEqual(150);
      await expect(bar(page).getByText('Chọn mã')).toBeVisible();
    });
  }

  test('máy hẹp 320px: tổng và nút không tràn ngang, cùng một hàng', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true, combo: 6_000 }, { width: 320, height: 640 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(pay.x + pay.width).toBeLessThanOrEqual(320);
    expect(Math.abs(mid(total) - mid(pay))).toBeLessThanOrEqual(16);
  });
});
