import type { Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { footerCart, type FooterCartOptions } from './support/cart-footer-mocks';

/**
 * Hiển thị giỏ web (G2, MINOR F10b và P2 #12–#14 của review hình bước chốt): "Tiết kiệm" cộng cả combo và cùng màu deal với giá, khối tổng ở chân dính
 * không tràn dưới nút Thanh toán ở 320px dù số lớn, 1280 cùng nhãn "Tạm tính (đã giảm)" với 375 cho cùng một số, nút "−" khoá khi SL 1, tên dòng cùng đậm với Mini.
 * Chỉ kiểm hiển thị: số khách trả do API mock tính sẵn, spec không đổi chúng. API mock toàn bộ (cùng cách với cart-footer.web.spec.ts).
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

async function openCart(page: Page, api: MockApi, o: FooterCartOptions, size: { width: number; height: number }) {
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

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
}

const bar = (page: Page) => page.getByTestId('sticky-bar');
const payButton = (page: Page) => bar(page).getByText(/^Thanh toán \(\d+\)$/);
/** Ở 375/320 chỉ chân dính hiện; ở 1280 chỉ khung tóm tắt hiện: lấy phần tử đang hiện của testid dùng chung. */
const visible = (page: Page, id: string): Locator => page.locator(`[data-testid="${id}"]:visible`);

test.describe('Giỏ web: Tiết kiệm (P2 #12)', () => {
  for (const [name, size] of [['375px', { width: 375, height: 812 }], ['1280px', { width: 1280, height: 900 }]] as const) {
    test(`${name}: cộng cả giảm combo: 17.000 + 31.000 giá gạch + 6.000 combo = 54.000đ, cùng màu deal với giá đang giảm`, async ({ page, api }) => {
      await openCart(page, api, { lines: 3, reached: true, combo: 6_000, deals: true }, size);

      const saving = visible(page, 'cart-saving');
      await expect(saving).toHaveText('Tiết kiệm 54.000đ');
      // Giá đang bán là <span>; cùng số còn nằm ở ô "thành tiền" (div, chỉ từ md) nên chọn theo thẻ span.
      const dealPrice = page.getByTestId('cart-line').first().locator('span', { hasText: /^33\.000đ$/ }).first();
      const [savingColor, priceColor] = await Promise.all([
        saving.evaluate((el) => getComputedStyle(el).color),
        dealPrice.evaluate((el) => getComputedStyle(el).color),
      ]);
      expect(savingColor, 'Tiết kiệm cùng màu với giá đang giảm').toBe(priceColor);
      expect(savingColor).toBe('rgb(154, 82, 0)');
    });
  }
});

/** Khối tổng (`cart-total-value`, `cart-saving`) không được cắt chữ hay đè dưới nút: cùng hàng thì nằm hẳn bên trái nút, hoặc nút xuống hàng riêng. */
async function expectNoOverlap(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'trang không tràn ngang').toBeLessThanOrEqual(width);
  const pay = (await payButton(page).boundingBox())!;
  expect(pay.x, 'nút không lọt ra ngoài trái').toBeGreaterThanOrEqual(0);
  expect(pay.x + pay.width, 'nút nằm trọn trong màn').toBeLessThanOrEqual(width);
  for (const id of ['cart-total-value', 'cart-saving']) {
    const el = bar(page).getByTestId(id);
    const fit = await el.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
    expect(fit.scroll, `${id} bị cắt (cần ${fit.scroll}px, có ${fit.client}px)`).toBeLessThanOrEqual(fit.client);
    const box = (await el.boundingBox())!;
    const sameRow = pay.y < box.y + box.height && box.y < pay.y + pay.height;
    if (sameRow) expect(box.x + box.width, `${id} đè dưới nút (phải ${Math.round(box.x + box.width)}px, nút bắt đầu ${Math.round(pay.x)}px)`).toBeLessThanOrEqual(pay.x);
  }
}

test.describe('Giỏ web: chân dính với số lớn (MINOR F10b)', () => {
  const cases: [string, FooterCartOptions, string, string][] = [
    ['tổng 12.345.000đ, tiết kiệm 1.234.000đ', { lines: 3, reached: true, unit: 4_115_000, saving: 1_234_000 }, '12.345.000đ', 'Tiết kiệm 1.234.000đ'],
    ['tổng 123.450.000đ, tiết kiệm 12.345.000đ', { lines: 3, reached: true, unit: 41_150_000, saving: 12_345_000 }, '123.450.000đ', 'Tiết kiệm 12.345.000đ'],
    ['tổng 1.234.500.000đ, tiết kiệm 123.450.000đ', { lines: 3, reached: true, unit: 411_500_000, saving: 123_450_000 }, '1.234.500.000đ', 'Tiết kiệm 123.450.000đ'],
  ];
  for (const width of [320, 375]) {
    for (const [name, opts, total, saving] of cases) {
      test(`${width}px, ${name}: không số nào bị cắt hay đè dưới nút Thanh toán, số tiền ghi đủ`, async ({ page, api }) => {
        await openCart(page, api, opts, { width, height: 640 });
        await expect(bar(page)).toBeVisible();
        await expect(bar(page).getByTestId('cart-total-value')).toHaveText(total);
        await expect(bar(page).getByTestId('cart-saving')).toHaveText(saving);
        await expectNoOverlap(page, width);
      });
    }
  }

  test('375px, số bình thường: nút vẫn cùng hàng với tổng và rộng đúng 148px (không phình khi chung hàng)', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true, combo: 6_000, deals: true }, { width: 375, height: 812 });
    const total = (await bar(page).getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(Math.abs(total.y + total.height / 2 - (pay.y + pay.height / 2))).toBeLessThanOrEqual(16);
    expect(Math.round(pay.width)).toBe(148);
  });
});

test.describe('Giỏ web: một nhãn cho một số (P2 #13)', () => {
  // Khung tóm tắt giữ cả hàng cho md (ẩn từ lg) lẫn hàng cho lg: chỉ đếm chữ đang hiện.
  const shown = (page: Page, text: string): Locator => page.getByTestId('cart-summary').getByText(text, { exact: true }).locator('visible=true');

  test('1280px: có giảm thì hàng cuối ghi "Tạm tính (đã giảm)" như 375px, hàng trên ghi "Tạm tính", không còn "Tổng"', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true, combo: 6_000 }, { width: 1280, height: 900 });
    await expect(shown(page, 'Tạm tính (đã giảm)')).toHaveCount(1);
    await expect(shown(page, 'Tạm tính')).toHaveCount(1);
    await expect(shown(page, 'Tổng')).toHaveCount(0);
  });

  test('375px: cùng chữ "Tạm tính (đã giảm)" ở chân dính', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true, combo: 6_000 }, { width: 375, height: 812 });
    await expect(bar(page).getByText('Tạm tính (đã giảm)', { exact: true })).toBeVisible();
  });

  test('1280px: không giảm gì thì chỉ một hàng "Tạm tính" (không có hàng gạch dư)', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true }, { width: 1280, height: 900 });
    await expect(shown(page, 'Tạm tính')).toHaveCount(1);
    await expect(shown(page, 'Tạm tính (đã giảm)')).toHaveCount(0);
    await expect(shown(page, 'Tổng')).toHaveCount(0);
  });
});

test.describe('Giỏ web: nút "−" và tên dòng như Mini (P2 #14)', () => {
  for (const [name, size] of [['375px', { width: 375, height: 812 }], ['1280px', { width: 1280, height: 900 }]] as const) {
    test(`${name}: SL 1 thì "Giảm số lượng" khoá, "Tăng số lượng" vẫn bấm được; tên dòng đậm 500`, async ({ page, api }) => {
      await openCart(page, api, { lines: 3, reached: true }, size);
      const row = page.getByTestId('cart-line').first();
      await expect(row.getByRole('button', { name: /^Giảm số lượng/ })).toBeDisabled();
      await expect(row.getByRole('button', { name: /^Tăng số lượng/ })).toBeEnabled();
      const weight = await row.getByRole('link', { name: 'Sản phẩm thử 1' }).evaluate((el) => getComputedStyle(el.parentElement!).fontWeight);
      expect(weight, 'tên dòng đậm 500 như Mini').toBe('500');
    });
  }
});

test.describe('Giỏ web: ô chọn cột 24 + khoảng 12 như Mini (G2 MINOR, PL-19)', () => {
  test('375px: ô chọn rộng 24, ảnh cách ô 12 (cùng x với Mini), vùng chạm vẫn 44 và bấm vào phần nhô ra vẫn đổi lựa chọn', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true }, { width: 375, height: 812 });

    const row = page.getByTestId('cart-line').first();
    const input = row.getByRole('checkbox');
    const hit = row.locator('label:has(input[type="checkbox"])');
    const [hitBox, controlBox, thumb, rowBox] = await Promise.all([hit.boundingBox(), input.locator('xpath=..').boundingBox(), row.getByTestId('cart-line-thumb').boundingBox(), row.boundingBox()]);
    expect(Math.round(hitBox!.width), 'vùng chạm rộng 44').toBe(44);
    expect(hitBox!.height).toBeGreaterThanOrEqual(44);
    expect(Math.round(controlBox!.width)).toBe(24);
    expect(Math.round(controlBox!.x - rowBox!.x), 'đệm trái của thẻ giữ 12').toBe(12);
    expect(Math.round(thumb!.x - (controlBox!.x + controlBox!.width)), 'ô chọn cách ảnh 12px').toBe(12);

    await expect(input).toBeChecked();
    // Điểm nhô ra hai bên ô (đệm của thẻ, khe tới ảnh) vẫn thuộc vùng chạm: đổi lựa chọn.
    await page.mouse.click(hitBox!.x + 3, hitBox!.y + hitBox!.height / 2);
    await expect(input).not.toBeChecked();
    await page.mouse.click(hitBox!.x + hitBox!.width - 3, hitBox!.y + hitBox!.height / 2);
    await expect(input).toBeChecked();
  });

  test('1280px: cột ô chọn giữ 36px như cũ (chỉ khổ điện thoại đổi)', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true }, { width: 1280, height: 900 });
    const row = page.getByTestId('cart-line').first();
    const hit = row.locator('label:has(input[type="checkbox"])');
    expect(Math.round((await hit.boundingBox())!.width)).toBe(36);
  });
});
