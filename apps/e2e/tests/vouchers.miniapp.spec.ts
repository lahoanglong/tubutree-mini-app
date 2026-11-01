import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockNoSession } from './support/flash-slot-mocks';
import { expectChipHitArea44 } from './support/hit-area';
import { WALLET, mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — Mã giảm giá (/vouchers): ba tab Nhận mã / Mã của tôi / Đã dùng–hết hạn trên URL (?tab=), chip lọc theo tab đang xem,
 * khách chưa đăng nhập xem được Nhận mã còn hai tab kia mời đăng nhập. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

test.describe('Mã giảm giá — khách đã đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api);
    mockWallet(api);
    mockCouponHistory(api);
  });

  test('ba tab; Nhận mã sắp mã chưa nhận lên trước và mã đã có trong ví hiện Đã lưu', async ({ page }) => {
    await page.goto('/vouchers');
    const tabs = page.getByRole('tablist', { name: 'Nhóm mã giảm giá' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await expect(tabs.getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'Mã của tôi' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Đã dùng–hết hạn' })).toBeVisible();
    const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
    await expect(panel.getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    await expect(panel.getByRole('button', { name: 'Lưu mã' })).toHaveCount(2);
    await expect(panel.getByRole('group', { name: 'Giảm 30.000đ' }).getByRole('button', { name: 'Dùng ngay' })).toBeVisible();
    await expect(page.getByText('Mỗi đơn dùng 1 mã')).toBeVisible();
  });

  test('đổi tab ghi ?tab= lên URL, chip lọc tính theo tab đang xem và đặt lại khi đổi tab', async ({ page }) => {
    await page.goto('/vouchers');
    const tabs = page.getByRole('tablist', { name: 'Nhóm mã giảm giá' });
    await expect(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group')).toHaveCount(3, { timeout: 15_000 });

    await tabs.getByRole('tab', { name: 'Mã của tôi' }).click();
    await expect.poll(() => new URL(page.url()).search).toBe('?tab=mine');
    const mine = page.getByRole('tabpanel', { name: 'Mã của tôi' });
    await expect(mine.getByRole('group')).toHaveCount(2);

    const freeship = page.getByRole('button', { name: 'Miễn phí giao hàng', exact: true });
    await freeship.click();
    await expect(freeship).toHaveAttribute('aria-pressed', 'true');
    await expect(mine.getByRole('group')).toHaveCount(1);
    await expect(mine.getByRole('group', { name: /Miễn phí giao hàng/ })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Đã dùng–hết hạn' }).click();
    await expect.poll(() => new URL(page.url()).search).toBe('?tab=history');
    const history = page.getByRole('tabpanel', { name: 'Đã dùng–hết hạn' });
    await expect(history.getByRole('group')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Tất cả', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Mã đã dùng hoặc hết hạn không còn nút hành động.
    await expect(history.getByRole('button')).toHaveCount(0);
  });

  test('chip lọc có vùng chạm 44px', async ({ page }) => {
    await page.goto('/vouchers');
    await expect(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    // Chip cuối nằm ngoài khung nên phải cuộn hàng; sau cuộn WebKit vẽ thanh cuộn nổi ở đáy hàng và `elementFromPoint` trả về hàng thay vì chip.
    // Ngón tay không chạm thanh cuộn, nên tắt nó để đo đúng vùng chạm của chip.
    await page.addStyleTag({ content: '.scroll-x{scrollbar-width:none}.scroll-x::-webkit-scrollbar{display:none}' });
    for (const name of ['Tất cả', 'Giảm giá', 'Miễn phí giao hàng', 'Sắp hết hạn']) {
      await expectChipHitArea44(page.getByRole('button', { name, exact: true }));
    }
  });

  test('chip "Sắp hết hạn" chỉ giữ mã hết hạn trong 3 ngày', async ({ page }) => {
    await page.goto('/vouchers?tab=mine');
    const mine = page.getByRole('tabpanel', { name: 'Mã của tôi' });
    await expect(mine.getByRole('group')).toHaveCount(2, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Sắp hết hạn', exact: true }).click();
    // Chỉ QUA-FS còn 2 ngày; KM30K còn 12 ngày.
    await expect(mine.getByRole('group')).toHaveCount(1);
    await expect(mine.getByRole('group', { name: /Miễn phí giao hàng/ })).toBeVisible();
  });

  test('ví chỉ có mã còn dài hạn: lọc "Sắp hết hạn" ra rỗng thì báo "Không có mã nào ở mục này"', async ({ page, api }) => {
    mockWallet(api, WALLET.slice(0, 1));
    await page.goto('/vouchers?tab=mine');
    await expect(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group')).toHaveCount(1, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Sắp hết hạn', exact: true }).click();
    await expect(page.getByText('Không có mã nào ở mục này')).toBeVisible();
    await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group')).toHaveCount(1);
  });
});

test.describe('Mã giảm giá — khách chưa đăng nhập', () => {
  test('Nhận mã xem được; Mã của tôi và Đã dùng–hết hạn mời đăng nhập, không gọi /me/*', async ({ page, api }) => {
    mockNoSession(api);
    mockCollectable(api);
    await page.goto('/vouchers');
    const claim = page.getByRole('tabpanel', { name: 'Nhận mã' });
    await expect(claim.getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    await expect(claim.getByRole('button', { name: 'Lưu mã' })).toHaveCount(3);

    await page.getByRole('tab', { name: 'Mã của tôi' }).click();
    await expect(page.getByRole('button', { name: 'Đăng nhập ngay' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: 'Đã dùng–hết hạn' }).click();
    await expect(page.getByRole('button', { name: 'Đăng nhập ngay' })).toBeVisible();
    expect(api.callsTo('GET', '/me/coupons')).toHaveLength(0);
    expect(api.callsTo('GET', '/me/coupons/history')).toHaveLength(0);
    expect(api.callsTo('POST', '/coupons/claim')).toHaveLength(0);
  });
});
