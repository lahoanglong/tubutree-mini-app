import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { COMBO_DISCOUNT, COMBO_TITLE, mockComboCartRoutes, type ComboCartOptions } from './support/cart-combo-mocks';

/**
 * Giỏ web có combo (K5), cùng kịch bản với cart-combo.miniapp.spec.ts: khối combo dưới đầu nhóm, món lẻ như cũ, tên dài không tràn ngang ở 320-375px,
 * số đo khối ở 375px bằng đúng bảng của Mini App, bỏ món khoá thì hỏi trước (không chặn). API mock toàn bộ (cùng cách với cart-display.web.spec.ts).
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

async function openCart(page: Page, api: MockApi, o: ComboCartOptions, size: { width: number; height: number }) {
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
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
  const routes = mockComboCartRoutes(api, o);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-combo-group')).toBeVisible({ timeout: 30_000 });
  return routes;
}

const group = (page: Page) => page.getByTestId('cart-combo-group');
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('Giỏ web: khối combo', () => {
  for (const [name, size] of [['375px', PHONE], ['1280px', DESKTOP]] as const) {
    test(`${name}: một khối chứa hai món của bộ, món lẻ nằm ngoài, đầu nhóm ghi tên và Tiết kiệm; số combo vẫn có ở phần tóm tắt`, async ({ page, api }) => {
      await openCart(page, api, {}, size);
      await expect(page.getByTestId('cart-combo-heading')).toHaveText(`Combo: ${COMBO_TITLE} · Tiết kiệm 65.250đ`);
      await expect(group(page)).toHaveAccessibleName(`Combo: ${COMBO_TITLE} · Tiết kiệm 65.250đ`);
      await expect(group(page).getByTestId('cart-line')).toHaveCount(2);
      await expect(group(page).getByText('Món combo 1', { exact: true })).toBeVisible();
      await expect(group(page).getByText('Món combo 2', { exact: true })).toBeVisible();
      await expect(group(page).getByText('Món lẻ 1')).toHaveCount(0);
      await expect(page.getByTestId('cart-line')).toHaveCount(3);
      const summary = size.width < 768 ? page.getByTestId('sticky-bar') : page.getByTestId('cart-summary-rows');
      await expect(summary.getByText('Giảm giá combo')).toBeVisible();
      await expect(summary.getByText('-65.250đ')).toBeVisible();
      const color = await page.getByTestId('cart-combo-saving').locator('span').evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe('rgb(154, 82, 0)');
    });
  }

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

  test('375px: số đo khối bằng bảng của Mini App: lề 12, rộng 351, đầu nhóm 16px, khe 8, thẻ dòng cách mép khối 8', async ({ page, api }) => {
    await openCart(page, api, {}, PHONE);
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
        background: getComputedStyle(g).backgroundColor,
        rail: getComputedStyle(g).borderLeftWidth,
      };
    });
    expect(m).toEqual({ x: 12, width: 351, headingSize: '16px', headingWeight: '700', lineInset: 8, lineGap: 8, background: 'rgb(242, 245, 236)', rail: '0px' });
  });

  test('1280px: khối không có nền riêng, đầu nhóm là dải nền dịu, các dòng ngăn bằng đường kẻ trong thẻ giỏ, vạch dọc bên trái chạy hết khối', async ({ page, api }) => {
    await openCart(page, api, {}, DESKTOP);
    const m = await group(page).evaluate((g) => {
      const css = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);
      const head = g.querySelector('[data-testid="cart-combo-heading"]')!.parentElement!;
      const lines = [...g.querySelectorAll('[data-testid="cart-line"]')];
      return {
        background: css(g).backgroundColor,
        radius: css(g).borderTopLeftRadius,
        headBackground: css(head).backgroundColor,
        lineBorder: css(lines[1]!).borderTopWidth,
        border: css(g).borderLeftWidth,
        rail: { position: css(g, '::before').position, width: css(g, '::before').width, visible: css(g, '::before').backgroundColor !== 'rgba(0, 0, 0, 0)' },
        // Vạch cao đúng khối (làm tròn của getComputedStyle: sai số dưới 1px), và khối đủ chỗ cho đầu nhóm + mọi dòng.
        railSpansBlock:
          Math.abs(parseFloat(css(g, '::before').height) - g.getBoundingClientRect().height) < 1 &&
          g.getBoundingClientRect().height >= head.getBoundingClientRect().height + lines.length * lines[0]!.getBoundingClientRect().height - 1,
      };
    });
    expect(m).toEqual({
      background: 'rgba(0, 0, 0, 0)',
      radius: '0px',
      headBackground: 'rgb(242, 245, 236)',
      lineBorder: '1px',
      border: '0px',
      rail: { position: 'absolute', width: '4px', visible: true },
      railSpansBlock: true,
    });
    // Vạch không chiếm chỗ: cột ô chọn của dòng trong bộ thẳng hàng với dòng lẻ cùng thẻ giỏ.
    const [inBlock, alone] = await Promise.all([
      page.getByRole('checkbox', { name: 'Chọn Món combo 1 để thanh toán' }).boundingBox(),
      page.getByRole('checkbox', { name: 'Chọn Món lẻ 1 để thanh toán' }).boundingBox(),
    ]);
    expect(inBlock!.x, 'ô chọn dòng trong bộ thẳng cột với dòng lẻ').toBeCloseTo(alone!.x, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(DESKTOP.width);
  });
});

test.describe('Giỏ web: bỏ món của bộ combo', () => {
  for (const [name, size] of [['375px', PHONE], ['1280px', DESKTOP]] as const) {
    test(`${name}: bấm Xoá món khoá: hộp hỏi "sẽ mất giảm", chưa xoá; Giữ lại thì thôi; Vẫn bỏ xoá và bộ hết khớp`, async ({ page, api }) => {
      const routes = await openCart(page, api, {}, size);
      const trash = page.getByRole('button', { name: 'Xoá Món combo 2 khỏi giỏ hàng' });
      await expect(trash).toHaveAttribute('aria-haspopup', 'dialog');
      await trash.click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText('Bỏ món khỏi combo?');
      await expect(dialog(page)).toContainText(`Combo ${COMBO_TITLE} sẽ mất giảm 65.250đ nếu bạn bỏ món này.`);
      expect(routes.removed).toEqual([]);

      await dialog(page).getByRole('button', { name: 'Giữ lại' }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(routes.removed).toEqual([]);
      await expect(page.getByTestId('cart-line')).toHaveCount(3);

      await trash.click();
      await dialog(page).getByRole('button', { name: 'Vẫn bỏ' }).click();
      await expect.poll(() => routes.removed).toEqual(['cb-2']);
      await expect(group(page)).toHaveCount(0);
    });
  }

  test('món lẻ xoá ngay, không hỏi', async ({ page, api }) => {
    const routes = await openCart(page, api, {}, PHONE);
    await page.getByRole('button', { name: 'Xoá Món lẻ 1 khỏi giỏ hàng' }).click();
    await expect.poll(() => routes.removed).toEqual(['lz-1']);
    await expect(dialog(page)).toHaveCount(0);
    await expect(group(page)).toBeVisible();
  });

  test('bỏ chọn một món của bộ: đầu nhóm không ghi Tiết kiệm, nhắc chọn đủ món; chọn lại thì trở về', async ({ page, api }) => {
    await openCart(page, api, {}, PHONE);
    await page.getByRole('checkbox', { name: 'Chọn Món combo 2 để thanh toán' }).uncheck({ force: true });
    await expect(page.getByTestId('cart-combo-heading')).toHaveText(`Combo: ${COMBO_TITLE}`);
    await expect(page.getByTestId('cart-combo-hint')).toHaveText(`Chọn đủ các món để được giảm ${COMBO_DISCOUNT.toLocaleString('vi-VN')}đ`);
    await page.getByRole('checkbox', { name: 'Chọn Món combo 2 để thanh toán' }).check({ force: true });
    await expect(page.getByTestId('cart-combo-heading')).toContainText('Tiết kiệm 65.250đ');
  });
});
