import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { WALLET, mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';
import { PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';
import { mockAffiliateDashboard, CTV_MILESTONES } from './support/affiliate-mocks';
import { NARROW_WIDTHS } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback, waitUntilStill } from './support/touch-probe';
import { mockLoyaltyScreen, mockAddressBook, mockReviewsWithMedia, ELIGIBLE_TO_REVIEW } from './support/touch-p4-mocks';

/**
 * W40A: phản hồi khi nhấn giữ ở Cá nhân, Điểm Xanh, Mã giảm giá, Sổ địa chỉ, Đánh giá và Cộng tác viên của Mini App ở 320 / 360 / 375px:
 * nút, chip, hàng bấm được co 0,97..0,99; khách chọn giảm chuyển động thì không co. Chạy Chromium (phép đo hệ số co chập chờn trên WebKit Linux
 * của CI, xem touch-press.miniapp.spec.ts). API mock toàn bộ.
 */
test.use({ browserName: 'chromium' });

async function openProfile(page: Page, api: Parameters<typeof mockSession>[0]): Promise<void> {
  mockSession(api, makeUser({ id: 'u-p4', fullName: 'Nguyễn Văn An', pointsBalance: 12_450, walletBalance: 1_250_000 }));
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 12_450, pointsConvertedBalance: 0 });
  api.get('/me/wallet', { walletBalance: 1_250_000 });
  api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
  api.get('/me/summary', { orders: { pending_payment: 2, processing: 1, shipping: 0, delivered: 5, closed: 0, active: 3 }, unreadNotifications: 7, activeSubscriptions: 0 });
  api.get('/me/notifications', []);
  api.allowUnmocked('GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary');
  await page.goto('/profile');
  await expect(page.getByText('12.450 điểm', { exact: true })).toBeVisible({ timeout: 15_000 });
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: co khi nhấn (Cá nhân, Điểm Xanh, Mã, Địa chỉ, Đánh giá, CTV)`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize({ width, height: 760 });
    });

    test('Cá nhân: hàng hồ sơ', async ({ page, api }) => {
      await openProfile(page, api);
      await expectPressFeedback(page, page.getByRole('button', { name: /Nguyễn Văn An/ }).first(), 'hàng hồ sơ (Chỉnh sửa hồ sơ)');
    });

    test('Điểm Xanh: nút Chép mã thành viên', async ({ page, api }) => {
      mockLoyaltyScreen(api);
      await page.goto('/loyalty');
      await expect(page.getByText('Lộc Biếc').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /Thẻ thành viên số/ }).click();
      await expectPressFeedback(page, page.getByRole('button', { name: /^Chép$/ }), 'nút Chép mã thành viên');
    });

    test('Mã giảm giá: Lưu mã và chip lọc', async ({ page, api }) => {
      mockDiscovery(api, { returning: true });
      mockHomeEngagement(api);
      mockCollectable(api);
      mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
      mockWallet(api, WALLET);
      mockCouponHistory(api);
      await page.goto('/vouchers');
      await expect(page.getByRole('button', { name: 'Lưu mã' }).first()).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: 'Lưu mã' }).first(), 'nút Lưu mã');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Giảm giá', exact: true }), 'chip lọc Giảm giá');
    });

    test('Sổ địa chỉ: Đặt mặc định, Sửa, Xoá, Thêm địa chỉ', async ({ page, api }) => {
      mockAddressBook(api);
      await page.goto('/addresses');
      await expect(page.getByText('Mặc định', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: 'Đặt mặc định' }).first(), 'nút Đặt mặc định');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Sửa' }).first(), 'nút Sửa');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Xoá' }).first(), 'nút Xoá');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Thêm địa chỉ mới' }), 'nút Thêm địa chỉ mới');
    });

    test('Đánh giá: chip lọc, chọn sao và nút Gửi đánh giá', async ({ page, api }) => {
      mockPilotProduct(api);
      mockReviewsWithMedia(api);
      api.get('/products/:slug/reviews/can-review', ELIGIBLE_TO_REVIEW);
      await page.goto(`/product/${PILOT_SLUG}`);
      const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
      await reviews.scrollIntoViewIfNeeded();
      await expect(reviews.getByText('Nhận xét r1')).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, reviews.getByRole('button', { name: /^5 sao/ }), 'chip lọc 5 sao');
      await expect.poll(() => api.callsTo('GET', '/products/:slug/reviews/can-review').length, { timeout: 15_000 }).toBeGreaterThan(0);
      await reviews.getByRole('button', { name: 'Viết đánh giá' }).click({ timeout: 15_000 });
      const stars = page.getByRole('radiogroup', { name: 'Số sao' });
      await expect(stars).toBeVisible();
      // Tấm đáy của ZaUI trượt lên 200ms bằng react-spring: nhấn giữ khi tấm còn trượt thì chuột không còn nằm trên nút.
      await waitUntilStill(stars);
      await expectPressFeedback(page, stars.getByRole('radio', { name: '3 sao' }), 'nút chọn sao');
      // Phép đo chặn cú click: chọn sao thật để nút Gửi hết khoá (nút khoá không có :active).
      await stars.getByRole('radio', { name: '3 sao' }).click();
      await expect(stars.getByRole('radio', { name: '3 sao' })).toHaveAttribute('aria-checked', 'true');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Gửi đánh giá' }), 'nút Gửi đánh giá');
    });

    test('Cộng tác viên: nút Sao chép', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
      mockAffiliateDashboard(api, { milestones: CTV_MILESTONES });
      api.allowUnmocked('POST /events');
      await page.goto('/affiliate?tab=share');
      await expect(page.getByText('Mã giới thiệu của bạn')).toBeVisible({ timeout: 15_000 });
      const copy = page.getByRole('button', { name: /^Sao chép/ }).first();
      await copy.scrollIntoViewIfNeeded();
      await expectPressFeedback(page, copy, 'nút Sao chép');
    });

    test('giảm chuyển động thì nút và hàng không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      mockAddressBook(api);
      await page.goto('/addresses');
      await expect(page.getByText('Mặc định', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Sửa' }).first(), 'nút Sửa');
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Thêm địa chỉ mới' }), 'nút Thêm địa chỉ mới');
    });
  });
}
