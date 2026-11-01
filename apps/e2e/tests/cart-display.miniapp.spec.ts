import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockFooterCart, type FooterCartOptions } from './support/cart-footer-mocks';

/**
 * Hiển thị giỏ Mini App (G2, MINOR F10b và P2 #12–#15 của review hình bước chốt): "Tiết kiệm" cộng cả combo và cùng màu deal với giá,
 * khối tổng ở chân dính không tràn dưới nút Thanh toán ở 320px dù số lớn, Tab tới ô cuối giỏ không nằm dưới chân dính, ô chọn cột 24 + khoảng 12.
 * Chỉ kiểm hiển thị: số khách trả do API mock tính sẵn, spec không đổi chúng. API mock toàn bộ.
 */
const bar = (page: Page) => page.getByTestId('sticky-bar');
const payButton = (page: Page) => bar(page).getByRole('button', { name: /^Thanh toán/ });

async function setSafeBottom(page: Page, px: number): Promise<void> {
  await page.addInitScript((value) => {
    document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--safe-bottom', `${value}px`));
  }, px);
}

async function openCart(page: Page, api: Parameters<typeof mockFooterCart>[0], o: FooterCartOptions, size = { width: 375, height: 812 }): Promise<void> {
  mockFooterCart(api, o);
  await page.setViewportSize(size);
  await page.goto('/cart');
  await expect(bar(page)).toBeVisible({ timeout: 15_000 });
  await expect(payButton(page)).toBeVisible();
}

test.beforeEach(({ api }) => {
  mockSession(api, makeUser({ id: 'user-cart-display', fullName: 'Khách Giỏ' }));
});

test.describe('Giỏ Mini App: Tiết kiệm (P2 #12)', () => {
  test('cộng cả giảm combo: 17.000 + 31.000 giá gạch + 6.000 combo = 54.000đ, cùng màu deal với giá đang giảm', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true, combo: 6_000, deals: true });

    const saving = page.getByTestId('cart-saving');
    await expect(saving).toHaveText('Tiết kiệm 54.000đ');
    const dealPrice = page.getByTestId('cart-line').first().getByText('33.000đ', { exact: true });
    const [savingColor, priceColor] = await Promise.all([
      saving.evaluate((el) => getComputedStyle(el).color),
      dealPrice.evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(savingColor, 'Tiết kiệm cùng màu với giá đang giảm').toBe(priceColor);
    expect(savingColor).toBe('rgb(154, 82, 0)');
  });
});

/** Khối tổng (`cart-total-value`, `cart-saving`) không được cắt chữ hay đè dưới nút: cùng hàng thì nằm hẳn bên trái nút, hoặc nút xuống hàng riêng. */
async function expectNoOverlap(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'trang không tràn ngang').toBeLessThanOrEqual(width);
  const pay = (await payButton(page).boundingBox())!;
  expect(pay.x, 'nút không lọt ra ngoài trái').toBeGreaterThanOrEqual(0);
  expect(pay.x + pay.width, 'nút nằm trọn trong màn').toBeLessThanOrEqual(width);
  for (const id of ['cart-total-value', 'cart-saving']) {
    const el: Locator = page.getByTestId(id);
    const fit = await el.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
    expect(fit.scroll, `${id} bị cắt (cần ${fit.scroll}px, có ${fit.client}px)`).toBeLessThanOrEqual(fit.client);
    const box = (await el.boundingBox())!;
    const sameRow = pay.y < box.y + box.height && box.y < pay.y + pay.height;
    if (sameRow) expect(box.x + box.width, `${id} đè dưới nút (phải ${Math.round(box.x + box.width)}px, nút bắt đầu ${Math.round(pay.x)}px)`).toBeLessThanOrEqual(pay.x);
  }
}

test.describe('Giỏ Mini App: chân dính với số lớn (MINOR F10b)', () => {
  const cases: [string, FooterCartOptions, string, string][] = [
    ['tổng 12.345.000đ, tiết kiệm 1.234.000đ', { lines: 3, reached: true, unit: 4_115_000, saving: 1_234_000 }, '12.345.000đ', 'Tiết kiệm 1.234.000đ'],
    ['tổng 123.450.000đ, tiết kiệm 12.345.000đ', { lines: 3, reached: true, unit: 41_150_000, saving: 12_345_000 }, '123.450.000đ', 'Tiết kiệm 12.345.000đ'],
    ['tổng 1.234.500.000đ, tiết kiệm 123.450.000đ', { lines: 3, reached: true, unit: 411_500_000, saving: 123_450_000 }, '1.234.500.000đ', 'Tiết kiệm 123.450.000đ'],
  ];
  for (const width of [320, 375]) {
    for (const [name, opts, total, saving] of cases) {
      test(`${width}px, ${name}: không số nào bị cắt hay đè dưới nút Thanh toán, số tiền ghi đủ`, async ({ page, api }) => {
        await openCart(page, api, opts, { width, height: 640 });
        await expect(page.getByTestId('cart-total-value')).toHaveText(total);
        await expect(page.getByTestId('cart-saving')).toHaveText(saving);
        await expectNoOverlap(page, width);
      });
    }
  }

  test('375px, số bình thường: nút vẫn cùng hàng với tổng và rộng đúng 148px (không phình khi chung hàng)', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true, combo: 6_000, deals: true });
    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const pay = (await payButton(page).boundingBox())!;
    expect(Math.abs(total.y + total.height / 2 - (pay.y + pay.height / 2))).toBeLessThanOrEqual(16);
    expect(Math.round(pay.width)).toBe(148);
  });
});

// Project "Zalo Mini App" chạy WebKit (iPhone 12): trên macOS phím Tab của WebKit bỏ qua nút và ô chọn gốc (chỉ dừng ở phần tử có tabindex), và `focus()`
// đưa phần tử ra GIỮA khung (nên không đo được scroll-padding). Khi Tab tới phần tử còn ở ngoài khung, trình duyệt cuộn tối thiểu (`block: 'nearest'`)
// tới cạnh khung trừ `scroll-padding`: đo đúng cơ chế đó bằng `scrollIntoView({ block: 'nearest' })` từ đầu trang.
test.describe('Giỏ Mini App: cuộn tối thiểu tới ô cuối giỏ không để nó nằm dưới chân dính (MINOR F10b, WCAG 2.4.11)', () => {
  for (const safe of [0, 34] as const) {
    test(`--safe-bottom ${safe}px: nút "Tăng số lượng" của dòng cuối nằm trên chân dính`, async ({ page, api }) => {
      await setSafeBottom(page, safe);
      await openCart(page, api, { lines: 8, reached: true });

      const scroller = page.locator('.zaui-page', { has: page.getByTestId('cart-line').first() }).first();
      await scroller.evaluate((el) => el.scrollTo(0, 0));
      const target = page.getByRole('button', { name: 'Tăng số lượng' }).last();
      await target.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(300);
      await page.waitForTimeout(300);
      const box = (await target.boundingBox())!;
      const top = (await bar(page).boundingBox())!.y;
      expect(box.y + box.height, `nút kết thúc ở ${Math.round(box.y + box.height)}px, chân dính bắt đầu ở ${Math.round(top)}px`).toBeLessThanOrEqual(top);
    });
  }
});

test.describe('Giỏ Mini App: ô chọn cột 24 + khoảng 12 (P2 #15, PL-19)', () => {
  test('ô chọn rộng 24, ảnh cách ô 12, vùng chạm vẫn 44 và bấm vào phần nhô ra vẫn đổi lựa chọn', async ({ page, api }) => {
    await openCart(page, api, { lines: 3, reached: true });

    const row = page.getByTestId('cart-line').first();
    const hit = row.getByTestId('checkbox-hit-area');
    const box = row.locator('.zaui-checkbox-wrapper .zaui-checkbox, .zaui-checkbox-wrapper > span').first();
    const [hitBox, thumb, rowBox] = await Promise.all([hit.boundingBox(), row.getByTestId('cart-line-thumb').boundingBox(), row.boundingBox()]);
    expect(Math.round(hitBox!.width), 'vùng chạm rộng 44').toBe(44);
    expect(hitBox!.height).toBeGreaterThanOrEqual(44);
    const control = (await box.boundingBox())!;
    expect(Math.round(control.width)).toBe(24);
    expect(Math.round(control.x - rowBox!.x), 'đệm trái của thẻ giữ 12').toBe(12);
    expect(Math.round(thumb!.x - (control.x + control.width)), 'ô chọn cách ảnh 12px').toBe(12);

    const input = row.getByRole('checkbox');
    await expect(input).toBeChecked();
    // Điểm nhô ra bên trái ô (đệm của thẻ) vẫn thuộc vùng chạm: đổi lựa chọn.
    await page.mouse.click(hitBox!.x + 3, hitBox!.y + hitBox!.height / 2);
    await expect(input).not.toBeChecked();
    await page.mouse.click(hitBox!.x + hitBox!.width - 3, hitBox!.y + hitBox!.height / 2);
    await expect(input).toBeChecked();
  });
});
