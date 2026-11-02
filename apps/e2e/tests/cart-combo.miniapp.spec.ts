import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { COMBO_DISCOUNT, COMBO_TITLE, mockComboCart, type ComboCartOptions } from './support/cart-combo-mocks';

/**
 * Giỏ Mini App có combo (K5): các món cùng bộ nằm dưới đầu nhóm "Combo: {tên} · Tiết kiệm {số}", món lẻ vẫn như cũ, chân dính còn dòng "Giảm giá combo",
 * tên dài/số lớn không tràn ngang ở 320–375px, bỏ món khoá của bộ thì hỏi trước (không chặn). Số khách trả do API mock tính sẵn; spec chỉ kiểm hiển thị
 * và luồng hộp báo. Số đo khối là số web phải ra (cart-combo.web.spec.ts khẳng định cùng bảng).
 */
const group = (page: Page) => page.getByTestId('cart-combo-group');

async function openCart(page: Page, api: Parameters<typeof mockComboCart>[0], o: ComboCartOptions = {}, size = { width: 375, height: 812 }) {
  const routes = mockComboCart(api, o);
  await page.setViewportSize(size);
  await page.goto('/cart');
  await expect(group(page)).toBeVisible({ timeout: 15_000 });
  return routes;
}

test.beforeEach(({ api }) => {
  mockSession(api, makeUser({ id: 'user-cart-combo', fullName: 'Khách Giỏ Combo' }));
});

test.describe('Giỏ Mini App: khối combo', () => {
  test('375px: một khối chứa hai món của bộ, món lẻ nằm ngoài, đầu nhóm ghi tên và Tiết kiệm; chân dính vẫn có Giảm giá combo', async ({ page, api }) => {
    await openCart(page, api);
    await expect(page.getByTestId('cart-combo-heading')).toHaveText(`Combo: ${COMBO_TITLE} · Tiết kiệm 65.250đ`);
    await expect(group(page)).toHaveAccessibleName(`Combo: ${COMBO_TITLE} · Tiết kiệm 65.250đ`);
    await expect(group(page).getByTestId('cart-line')).toHaveCount(2);
    await expect(group(page).getByText('Món combo 1', { exact: true })).toBeVisible();
    await expect(group(page).getByText('Món combo 2', { exact: true })).toBeVisible();
    await expect(group(page).getByText('Món lẻ 1')).toHaveCount(0);
    await expect(page.getByTestId('cart-line')).toHaveCount(3);
    const bar = page.getByTestId('sticky-bar');
    await expect(bar.getByText('Giảm giá combo')).toBeVisible();
    await expect(bar.getByText('-65.250đ')).toBeVisible();
    // Số trong đầu nhóm cùng màu deal với giá đang giảm.
    const color = await page.getByTestId('cart-combo-heading').locator('span').evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(154, 82, 0)');
  });

  for (const width of [320, 375]) {
    test(`${width}px: tên combo và tên món dài, số tiền lớn: không tràn ngang, đầu nhóm xuống dòng trọn trong khối`, async ({ page, api }) => {
      await openCart(
        page,
        api,
        { title: 'Bộ sản phẩm giặt tẩy sinh học dành cho gia đình đông người Fuwa3eKhongDauCach0123456789', discount: 123_450_000, unit: 411_500_000, firstName: 'Nước giặt hữu cơ hương oải hương Provence 3 lít Tubu' },
        { width, height: 812 },
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'trang không tràn ngang').toBeLessThanOrEqual(width);
      const heading = page.getByTestId('cart-combo-heading');
      const fit = await heading.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fit.scroll, `đầu nhóm bị cắt (cần ${fit.scroll}px, có ${fit.client}px)`).toBeLessThanOrEqual(fit.client);
      const [g, h] = await Promise.all([group(page).boundingBox(), heading.boundingBox()]);
      expect(h!.x).toBeGreaterThanOrEqual(g!.x);
      expect(h!.x + h!.width, 'đầu nhóm nằm trọn trong khối').toBeLessThanOrEqual(g!.x + g!.width);
      await expect(heading).toContainText('Tiết kiệm 123.450.000đ');
    });
  }

  test('375px: số đo khối (bảng web phải khớp): lề 12, rộng 351, đầu nhóm 16px, khe 8, thẻ dòng cách mép khối 8', async ({ page, api }) => {
    await openCart(page, api);
    const m = await page.evaluate(() => {
      const g = document.querySelector<HTMLElement>('[data-testid="cart-combo-group"]')!;
      const h = g.querySelector<HTMLElement>('[data-testid="cart-combo-heading"]')!;
      const lines = [...g.querySelectorAll<HTMLElement>('[data-testid="cart-line"]')];
      const r = (el: Element) => el.getBoundingClientRect();
      const gr = r(g);
      return {
        x: Math.round(gr.x),
        width: Math.round(gr.width),
        headingSize: getComputedStyle(h).fontSize,
        headingWeight: getComputedStyle(h).fontWeight,
        lineInset: Math.round(r(lines[0]!).x - gr.x),
        lineGap: Math.round(r(lines[1]!).top - r(lines[0]!).bottom),
        background: getComputedStyle(g.firstElementChild!).backgroundColor,
      };
    });
    expect(m).toEqual({ x: 12, width: 351, headingSize: '16px', headingWeight: '700', lineInset: 8, lineGap: 8, background: 'rgb(242, 245, 236)' });
  });
});

test.describe('Giỏ Mini App: bỏ món của bộ combo', () => {
  test('bấm thùng rác món khoá: hộp hỏi "sẽ mất giảm", chưa xoá; Giữ lại thì thôi; Vẫn bỏ xoá và bộ hết khớp', async ({ page, api }) => {
    const routes = await openCart(page, api);
    await page.getByRole('button', { name: 'Xoá Món combo 2' }).click();
    await expect(page.getByText('Bỏ món khỏi combo?')).toBeVisible();
    await expect(page.getByText(`Combo ${COMBO_TITLE} sẽ mất giảm 65.250đ nếu bạn bỏ món này.`)).toBeVisible();
    expect(routes.removed).toEqual([]);

    await page.getByRole('button', { name: 'Giữ lại' }).click();
    await expect(page.getByText('Bỏ món khỏi combo?')).toBeHidden();
    expect(routes.removed).toEqual([]);
    await expect(page.getByTestId('cart-line')).toHaveCount(3);

    await page.getByRole('button', { name: 'Xoá Món combo 2' }).click();
    await page.getByRole('button', { name: 'Vẫn bỏ' }).click();
    await expect.poll(() => routes.removed).toEqual(['cb-2']);
    await expect(group(page)).toHaveCount(0);
    await expect(page.getByTestId('sticky-bar').getByText('Giảm giá combo')).toHaveCount(0);
  });

  test('món lẻ xoá ngay, không hỏi', async ({ page, api }) => {
    const routes = await openCart(page, api);
    await page.getByRole('button', { name: 'Xoá Món lẻ 1' }).click();
    await expect.poll(() => routes.removed).toEqual(['lz-1']);
    await expect(page.getByText('Bỏ món khỏi combo?')).toHaveCount(0);
    await expect(group(page)).toBeVisible();
  });

  test('bỏ chọn một món của bộ: đầu nhóm không ghi Tiết kiệm, nhắc chọn đủ món, chân dính hết dòng combo; chọn lại thì trở về', async ({ page, api }) => {
    await openCart(page, api);
    await page.getByRole('checkbox', { name: 'Chọn Món combo 2' }).uncheck({ force: true });
    await expect(page.getByTestId('cart-combo-heading')).toHaveText(`Combo: ${COMBO_TITLE}`);
    await expect(page.getByTestId('cart-combo-hint')).toHaveText(`Chọn đủ các món để được giảm ${COMBO_DISCOUNT.toLocaleString('vi-VN')}đ`);
    await expect(page.getByTestId('sticky-bar').getByText('Giảm giá combo')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Chọn Món combo 2' }).check({ force: true });
    await expect(page.getByTestId('cart-combo-heading')).toContainText('Tiết kiệm 65.250đ');
    await expect(page.getByTestId('sticky-bar').getByText('Giảm giá combo')).toBeVisible();
  });
});
