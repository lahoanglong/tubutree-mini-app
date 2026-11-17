import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockNoSession } from './support/flash-slot-mocks';
import { expectChipHitArea44 } from './support/hit-area';
import { mockLoyaltyPreview, pathAndSearch } from './support/offers-mocks';
import { mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — Mã giảm giá nằm trong hub Ưu đãi. `/vouchers` cũ chỉ còn là chuyển hướng (link trong thông báo, ZNS đã gửi, chiến dịch cũ):
 * Nhận mã → Săn mã với kho mã mở cả (`?codes=all`), `tab=mine` → Mã của tôi, `tab=history` → Mã của tôi kèm "Mã đã dùng, hết hạn" mở sẵn; mọi tham số
 * khác giữ nguyên. Kho mở cả: mã chưa nhận "Lưu mã", mã đã lưu "Dùng ngay", mã đã dùng không nút, chip lọc 44px. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const collect = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Nhận mã', exact: true });

test.describe('Mã giảm giá trong Ưu đãi — khách đã đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api);
    mockWallet(api);
    mockCouponHistory(api);
  });

  test('/vouchers?code=X&utm_source=zns: về Săn mã, kho mã mở cả, giữ tham số; mã đã có trong ví hiện Dùng ngay', async ({ page }) => {
    await page.goto('/vouchers?code=KM30K&utm_source=zns');
    await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=deals&codes=all&code=KM30K&utm_source=zns');
    await expect(page.getByRole('tab', { name: 'Săn mã' })).toHaveAttribute('aria-selected', 'true');
    await expect(collect(page).getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    await expect(collect(page).getByRole('button', { name: 'Lưu mã' })).toHaveCount(2);
    await expect(collect(page).getByRole('group', { name: 'Giảm 30k' }).getByRole('button', { name: 'Dùng ngay' })).toBeVisible();
    await expect(collect(page).getByText('Mỗi đơn dùng 1 mã')).toBeVisible();
    await expect(collect(page).getByRole('button', { name: 'Thu gọn' })).toBeVisible();
  });

  test('mã đã nhận mà đã dùng hết lượt cá nhân (ví không còn): ghi Đã dùng và không có nút Lưu mã', async ({ page, api }) => {
    mockCollectableMine(api, { claimed: ['FS99'], newCustomerOnly: [] });
    await page.goto('/offers?codes=all');
    await expect(collect(page).getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    await expect(collect(page).getByRole('button', { name: 'Lưu mã' })).toHaveCount(1);
    await expect(collect(page).getByRole('group', { name: /Miễn phí giao hàng/ }).getByRole('button')).toHaveCount(0);
    await expect(collect(page).getByRole('group', { name: /Miễn phí giao hàng/ }).getByText('Đã dùng')).toBeVisible();
  });

  test('/vouchers?tab=mine: về Mã của tôi, cả ví', async ({ page }) => {
    await page.goto('/vouchers?tab=mine');
    await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=wallet');
    await expect(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group')).toHaveCount(2, { timeout: 15_000 });
  });

  test('/vouchers?tab=history: về Mã của tôi, "Mã đã dùng, hết hạn" mở sẵn, phiếu lịch sử không có nút', async ({ page }) => {
    await page.goto('/vouchers?tab=history');
    await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=wallet&history=1');
    const toggle = page.getByRole('button', { name: 'Mã đã dùng, hết hạn' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
    const history = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
    await expect(history.getByRole('group')).toHaveCount(2);
    await expect(history.getByRole('button')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('Mã của tôi: lịch sử đóng sẵn, chỉ gọi /me/coupons/history khi mở', async ({ page, api }) => {
    await page.goto('/offers?tab=wallet');
    await expect(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group')).toHaveCount(2, { timeout: 15_000 });
    const toggle = page.getByRole('button', { name: 'Mã đã dùng, hết hạn' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(api.callsTo('GET', '/me/coupons/history')).toHaveLength(0);
    await toggle.click();
    await expect(page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`).getByRole('group')).toHaveCount(2);
  });

  test('kho mã mở cả: chip lọc có vùng chạm 44px, "Thu gọn" về các mã còn nhận được', async ({ page }) => {
    await page.goto('/offers?codes=all');
    await expect(collect(page).getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    // Chip cuối có thể nằm ngoài khung: tắt thanh cuộn nổi của WebKit để `elementFromPoint` trả về chip, không phải hàng.
    await page.addStyleTag({ content: '.scroll-x{scrollbar-width:none}.scroll-x::-webkit-scrollbar{display:none}' });
    for (const name of ['Tất cả', 'Giảm giá', 'Miễn phí giao hàng']) {
      await expectChipHitArea44(collect(page).getByRole('button', { name, exact: true }));
    }
    await collect(page).getByRole('button', { name: 'Thu gọn' }).click();
    await expect(collect(page).getByRole('button', { name: 'Thu gọn' })).toHaveCount(0);
    await expect(collect(page).getByRole('button', { name: 'Lưu mã' })).toHaveCount(2);
    await expect(collect(page).getByRole('button', { name: 'Dùng ngay' })).toHaveCount(0);
  });
});

test.describe('Mã giảm giá trong Ưu đãi — khách chưa đăng nhập', () => {
  test('/vouchers: kho mã xem được, đủ Lưu mã; Mã của tôi mời đăng nhập; không gọi /me/*', async ({ page, api }) => {
    mockNoSession(api);
    mockCollectable(api);
    await page.goto('/vouchers');
    await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=deals&codes=all');
    await expect(collect(page).getByRole('button', { name: 'Lưu mã' })).toHaveCount(3, { timeout: 15_000 });

    await page.getByRole('tab', { name: 'Mã của tôi' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('GET', '/me/coupons')).toHaveLength(0);
    expect(api.callsTo('GET', '/me/coupons/history')).toHaveLength(0);
    expect(api.callsTo('POST', '/coupons/claim')).toHaveLength(0);
  });

  test('/rewards cũ: về tab Đổi quà, giữ tham số khác', async ({ page, api }) => {
    mockNoSession(api);
    mockLoyaltyPreview(api);
    await page.goto('/rewards?utm_source=zns');
    await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=rewards&utm_source=zns');
    await expect(page.getByRole('tab', { name: 'Đổi quà' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Miễn phí vận chuyển').first()).toBeVisible({ timeout: 15_000 });
  });
});
