import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { mockFooterCart } from './support/cart-footer-mocks';

/**
 * Chân dính của giỏ Mini App ở 375px (review hình bước chốt, P1 #7, sơ đồ CT-04): cao khoảng 140px thay vì 265px, tổng tiền và nút Thanh toán
 * cùng một hàng, đã đạt miễn phí giao thì chỉ còn một dòng chữ (không vẽ thanh đầy), và nội dung cuối giỏ không bị chân che dù chân cao thêm
 * (lời báo hết hàng, dòng giảm) hay máy có vùng an toàn đáy (`--safe-bottom`). API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const bar = (page: Page) => page.getByTestId('sticky-bar');
const payButton = (page: Page) => bar(page).getByRole('button', { name: /^Thanh toán/ });
const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
const barHeight = async (page: Page) => Math.round((await bar(page).boundingBox())!.height);

async function setSafeBottom(page: Page, px: number): Promise<void> {
  await page.addInitScript((value) => {
    document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--safe-bottom', `${value}px`));
  }, px);
}

async function openCart(page: Page): Promise<void> {
  await page.goto('/cart');
  await expect(bar(page)).toBeVisible({ timeout: 15_000 });
  await expect(payButton(page)).toBeVisible();
}

test.beforeEach(({ api }) => {
  mockSession(api, makeUser({ id: 'user-cart-footer', fullName: 'Khách Giỏ' }));
});

test.describe('Giỏ Mini App: chân dính gọn', () => {
  test('đã đạt miễn phí giao, không giảm gì: cao ≤150px, một dòng chữ không thanh, tổng và nút cùng một hàng', async ({ page, api }) => {
    mockFooterCart(api, { lines: 3, reached: true });
    await openCart(page);

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

  test('chưa đạt miễn phí giao, có dòng giảm combo (kèm dòng Tiết kiệm): vẫn có thanh tiến độ, cao ≤190px', async ({ page, api }) => {
    mockFooterCart(api, { lines: 3, reached: false, combo: 6_000 });
    await openCart(page);

    await expect(page.getByTestId('freeship-bar')).toHaveCount(1);
    await expect(bar(page).getByText('Giảm giá combo')).toBeVisible();
    const h = await barHeight(page);
    // Trước G2 combo không vào "Tiết kiệm" nên ca này không có dòng đó và cao ≤175; nay có dòng "Tiết kiệm 6.000đ" dưới số tiền (khối tổng cao hơn nút ~10px).
    await expect(page.getByTestId('cart-saving')).toHaveText('Tiết kiệm 6.000đ');
    expect(h, `chân dính cao ${h}px`).toBeLessThanOrEqual(190);
    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(Math.abs(mid(total) - mid(pay))).toBeLessThanOrEqual(12);
  });

  for (const safe of [0, 34] as const) {
    test(`giỏ 8 dòng có dòng hết hàng (--safe-bottom ${safe}px): cuộn hết thì dòng cuối nằm trên chân dính, chân cao đúng cộng vùng an toàn`, async ({ page, api }) => {
      mockFooterCart(api, { lines: 8, reached: true, outOfStock: true });
      await setSafeBottom(page, safe);
      await openCart(page);
      await expect(bar(page).getByRole('status')).toBeVisible();

      const scroller = page.locator('.zaui-page', { has: page.getByTestId('cart-line').first() }).first();
      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(300);
      const last = (await page.getByTestId('cart-line').last().boundingBox())!;
      const top = (await bar(page).boundingBox())!.y;
      expect(last.y + last.height, `dòng cuối kết thúc ở ${Math.round(last.y + last.height)}px, chân dính bắt đầu ở ${Math.round(top)}px`).toBeLessThanOrEqual(top);
      expect(Math.round((await bar(page).boundingBox())!.y + (await barHeight(page)))).toBe(812);
      // Lời báo hết hàng làm chân cao thêm một ít; trần này giữ để lời báo không phình chân thành nửa màn.
      expect(await barHeight(page)).toBeLessThanOrEqual(190 + safe);
    });
  }

  // AnimationRoutes gắn trang mới TRƯỚC rồi mới tháo trang cũ sau hiệu ứng thoát: thanh dính của trang Thanh toán tháo SAU thanh của Giỏ. Tháo mà xoá
  // `--sticky-bar-h` thì Giỏ rơi về số dự phòng (150px) thấp hơn chân thật (138px + vùng an toàn 34px) và che dòng cuối.
  test('vào lại giỏ từ trang Thanh toán bằng Quay lại (--safe-bottom 34px): --sticky-bar-h còn đúng và dòng cuối nằm trên chân dính', async ({ page, api }) => {
    mockCheckout(api);
    mockFooterCart(api, { lines: 8, reached: true });
    await setSafeBottom(page, 34);
    await openCart(page);

    await payButton(page).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole('button', { name: /Đặt hàng/ })).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/cart/);
    await expect(payButton(page)).toBeVisible({ timeout: 15_000 });
    // Chờ hiệu ứng thoát của trang Thanh toán xong: lúc đó DOM chỉ còn MỘT thanh dính (của Giỏ) và thanh Thanh toán đã chạy cleanup.
    await expect(bar(page)).toHaveCount(1, { timeout: 15_000 });

    const h = await barHeight(page);
    expect(h, 'chân dính cao đúng đáy + vùng an toàn').toBeGreaterThan(138 - 1);
    const published = await page.evaluate(() => document.documentElement.style.getPropertyValue('--sticky-bar-h'));
    expect(published, `--sticky-bar-h=${published}, chân cao ${h}px`).toBe(`${Math.ceil((await bar(page).boundingBox())!.height)}px`);

    const scroller = page.locator('.zaui-page', { has: page.getByTestId('cart-line').first() }).first();
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(300);
    const last = (await page.getByTestId('cart-line').last().boundingBox())!;
    const top = (await bar(page).boundingBox())!.y;
    expect(last.y + last.height, `dòng cuối kết thúc ở ${Math.round(last.y + last.height)}px, chân dính bắt đầu ở ${Math.round(top)}px`).toBeLessThanOrEqual(top);
  });

  for (const [usable, maxSaving, text] of [
    [6, 60_000, '6 mã · giảm đến 60k'],
    [9, 123_456, '9 mã · giảm đến 123k'],
    [99, 1_234_567, '99 mã · giảm đến 1,2tr'],
  ] as const) {
    test(`gợi ý ${usable} mã dùng được, mã tốt nhất giảm ${maxSaving}: hiện đủ "${text}" trên một dòng, không bị cắt "…" (P1 #8)`, async ({ page, api }) => {
      mockFooterCart(api, { lines: 3, reached: true, hint: { usable, maxSaving } });
      await openCart(page);

      const hint = bar(page).getByText(text, { exact: true });
      await expect(hint).toBeVisible();
      const fit = await hint.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fit.scroll, `chữ gợi ý cần ${fit.scroll}px, chỗ có ${fit.client}px`).toBeLessThanOrEqual(fit.client);
      // Số tiền làm tròn xuống k/tr nên luôn một dòng, kể cả số lẻ (123.456đ, 1.234.567đ) và 99 mã; hàng mã vẫn 44px nên chân dính không cao thêm.
      const lines = Math.round((await hint.evaluate((el) => el.getBoundingClientRect().height)) / 16);
      expect(lines, `gợi ý chiếm ${lines} dòng`).toBeLessThanOrEqual(1);
      expect(await barHeight(page), 'hàng mã vẫn 44px nên chân dính không cao thêm').toBeLessThanOrEqual(150);
      await expect(bar(page).getByRole('button', { name: /Mã giảm giá/ }).getByText('Chọn mã')).toBeVisible();
    });
  }

  test('máy hẹp 320px: tổng và nút không tràn ngang, nút không rớt xuống dưới số tiền', async ({ page, api }) => {
    mockFooterCart(api, { lines: 3, reached: true, combo: 6_000 });
    await page.setViewportSize({ width: 320, height: 640 });
    await openCart(page);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(pay.x + pay.width).toBeLessThanOrEqual(320);
    expect(Math.abs(mid(total) - mid(pay))).toBeLessThanOrEqual(16);
  });
});
