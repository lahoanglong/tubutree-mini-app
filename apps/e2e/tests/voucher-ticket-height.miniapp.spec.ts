import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';
import { COLLECT_TICKETS as COLLECT, LONG_NAME, WALLET_TICKETS as WALLET, expectButtonsStable, expectCompactTickets, expectNameVisibleWhole } from './support/voucher-ticket-checks';

/**
 * Zalo Mini App E2E — chiều cao phiếu mã giảm giá ở 375px (F10d, lỗi P1 #18; G1; M3): thiết kế ~88px, nhãn một dòng, điều kiện một hàng, tên admin hàng riêng dưới nhãn (trước điều kiện),
 * hạn · số lượt · mã một hàng đáy, một phiếu không trộn "99.000đ" với "99k". Dữ liệu giả cố tình có tên 40 ký tự, tên lặp số và mã dài 15 ký tự cùng "Còn 3 lượt".
 * Tên admin ở hàng riêng rộng hết cột, tối đa hai dòng (M3): phiếu có tên cao thêm đúng chiều cao hàng tên (20px một dòng, 40px hai dòng). Đo ở 375px: phiếu tên 40 ký tự + hàng đáy gãy 138px (trước khi tên xuống hàng riêng: 118px), phiếu tên ngắn 98px, phiếu trơn 88px. Nút chính giữ cỡ và nằm trọn trong phiếu.
 * Ở 320px (máy nhỏ nhất của Zalo) chỉ giữ hai điều: mã không bị cắt, tên không quá hai dòng và không đẩy nút. API mock toàn bộ.
 */

test.describe('Phiếu mã giảm giá ở 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api, COLLECT as never);
    mockWallet(api, WALLET as never);
    mockCouponHistory(api);
  });

  test('Mã của tôi: phiếu 88 đến 96px (hàng đáy gãy thì 104px), nhãn một dòng, không trộn cách ghi số', async ({ page }) => {
    await page.goto('/vouchers?tab=mine');
    await expectCompactTickets(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group'), WALLET.length);
    await expectNameVisibleWhole(page.getByRole('tabpanel', { name: 'Mã của tôi' }));
    await expectButtonsStable(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group'));
  });

  test('Nhận mã: phiếu có tên, mã dài và "Còn 3 lượt" vẫn trong khung 104px, cạnh phiếu trơn chênh không quá 16px', async ({ page }) => {
    await page.goto('/vouchers');
    await expectCompactTickets(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group'), COLLECT.length);
    await expectNameVisibleWhole(page.getByRole('tabpanel', { name: 'Nhận mã' }));
  });

  test('Nhận mã: tên admin 40 ký tự xuống tối đa hai dòng, nút "Lưu mã" giữ cỡ và nằm trọn trong phiếu (M3)', async ({ page }) => {
    await page.goto('/vouchers');
    const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
    const groups = panel.getByRole('group');
    await expect(groups).toHaveCount(COLLECT.length, { timeout: 15_000 });
    const name = panel.getByTestId('voucher-name').filter({ hasText: LONG_NAME }).first();
    await expect(name).toBeVisible();
    const h = (await name.boundingBox())!.height;
    expect(h, `tên cao ${h}px`).toBeGreaterThan(24);
    expect(h, `tên cao ${h}px`).toBeLessThanOrEqual(41);
    const nameW = (await name.boundingBox())!.width;
    const metaW = (await name.locator('xpath=following-sibling::*[@data-testid="voucher-meta"]').boundingBox())!.width;
    expect(nameW, `tên rộng ${nameW}px, điều kiện ${metaW}px`).toBeGreaterThan(140);
    await expectButtonsStable(groups);
  });
});

test.describe('Phiếu mã giảm giá ở 320px', () => {
  test.use({ viewport: { width: 320, height: 812 } });

  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api, COLLECT as never);
    mockWallet(api, WALLET as never);
    mockCouponHistory(api);
  });

  test('Nhận mã: mã dài 15 ký tự nằm trọn trong phiếu, không bị cắt', async ({ page }) => {
    await page.goto('/vouchers');
    const code = page.getByTestId('voucher-code').filter({ hasText: 'NHANLOCXANH2026' });
    await expect(code).toBeVisible({ timeout: 15_000 });
    const fits = await code.evaluate((el) => {
      const c = el.getBoundingClientRect();
      const t = el.closest('[role="group"]')!.getBoundingClientRect();
      return c.left >= t.left && c.right <= t.right && el.scrollWidth <= el.clientWidth + 1;
    });
    expect(fits, 'mã tràn ra ngoài phiếu').toBe(true);
  });

  test('Nhận mã: tên 40 ký tự không quá hai dòng và không đẩy nút ra ngoài phiếu (M3)', async ({ page }) => {
    await page.goto('/vouchers');
    const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
    const groups = panel.getByRole('group');
    await expect(groups).toHaveCount(COLLECT.length, { timeout: 15_000 });
    const name = panel.getByTestId('voucher-name').filter({ hasText: LONG_NAME }).first();
    expect((await name.boundingBox())!.height).toBeLessThanOrEqual(41);
    await expectButtonsStable(groups);
  });
});
