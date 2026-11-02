import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockFooterCart } from './support/cart-footer-mocks';
import { blockingViolations, runAxe, staleBaseline } from './support/axe';
import { expectChipHitArea44 } from './support/hit-area';

/**
 * Tấm "Chọn mã giảm giá" của giỏ Mini App ở 375px (K3, review bổ sung 2 P1 #4 #5 #8, P2 #6 #7): mỗi mã là một phiếu, thứ tự dùng được trước,
 * chưa đủ sau, không áp dụng cuối; không làm mờ cả thẻ (chữ lý do phải đọc được, axe color-contrast kiểm); không còn chữ "HSD"; nút khoá
 * dùng chung "Không áp dụng". API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const WALLET = [
  { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: 900_000, maxDiscount: 50_000, endAt: inDays(30) },
  { code: 'SHIPDEP', type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: inDays(2) },
  { code: 'GIAM30K', type: 'AMOUNT', value: 30_000, minOrder: null, maxDiscount: null, endAt: inDays(12) },
];
const PREVIEWS = [
  { code: 'XANH10', eligible: false, discount: 0, reason: 'Đơn tối thiểu 900.000đ để dùng mã này.' },
  { code: 'SHIPDEP', eligible: false, discount: 0, reason: 'Đơn này đã được miễn phí giao hàng.' },
  { code: 'GIAM30K', eligible: true, discount: 30_000 },
];

const dialog = (page: Page) => page.getByRole('dialog');

async function openPicker(page: Page): Promise<void> {
  await page.goto('/cart');
  await page.getByText('Chọn mã', { exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Chọn mã giảm giá' })).toBeVisible({ timeout: 15_000 });
  await expect(dialog(page).getByTestId('voucher-reason').first()).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(({ api }) => {
  mockSession(api, makeUser({ id: 'user-voucher-picker', fullName: 'Khách Chọn Mã' }));
  mockFooterCart(api, { lines: 2 });
  api.get('/me/coupons', WALLET);
  api.post('/checkout/coupon-previews', { coupons: PREVIEWS });
});

test.describe('Giỏ Mini App: tấm chọn mã giảm giá', () => {
  test('mã dùng được trước, chưa đủ sau, không áp dụng cuối; mỗi nút một nhãn chung; không "HSD"', async ({ page }) => {
    await openPicker(page);
    const buttons = dialog(page).getByRole('list', { name: 'Mã giảm giá của bạn' }).getByRole('button');
    await expect(buttons).toHaveCount(3);
    expect(await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
      'Dùng mã GIAM30K',
      'Chưa đủ điều kiện dùng mã XANH10',
      'Không áp dụng mã SHIPDEP',
    ]);
    await expect(buttons.nth(0)).toHaveText('Dùng');
    await expect(buttons.nth(1)).toHaveText('Chưa đủ');
    await expect(buttons.nth(2)).toHaveText('Không áp dụng');
    expect(await dialog(page).innerText()).not.toMatch(/HSD|Đơn tối thiểu|0đ\b/);
    await expect(dialog(page).getByText('Giảm 30.000đ cho đơn này')).toBeVisible();
  });

  test('không làm mờ cả thẻ: không phần tử nào trong danh sách có opacity < 1', async ({ page }) => {
    await openPicker(page);
    const dimmed = await dialog(page)
      .getByRole('list', { name: 'Mã giảm giá của bạn' })
      .evaluate((ul) => Array.from(ul.querySelectorAll<HTMLElement>('*')).filter((el) => Number(getComputedStyle(el).opacity) < 1).map((el) => el.tagName));
    expect(dimmed).toEqual([]);
  });

  test('axe 375px khi tấm mở: chữ lý do và nút khoá đủ tương phản (serious/critical chặn)', async ({ page }) => {
    await openPicker(page);
    const found = await runAxe(page);
    expect(blockingViolations('miniapp', 'Chọn mã giảm giá', found)).toEqual([]);
    expect(staleBaseline('miniapp', 'Chọn mã giảm giá', found)).toEqual([]);
  });

  test('nút "Dùng" cao 36px nhưng vùng chạm 44px', async ({ page }) => {
    await openPicker(page);
    await expectChipHitArea44(dialog(page).getByRole('button', { name: 'Dùng mã GIAM30K' }));
  });
});
