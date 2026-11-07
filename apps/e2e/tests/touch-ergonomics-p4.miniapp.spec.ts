import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { WALLET, mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';
import { PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';
import { mockAffiliateDashboard, CTV_MILESTONES } from './support/affiliate-mocks';
import { NARROW_WIDTHS, probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';
import { mockLoyaltyScreen, mockAddressBook, mockReviewsWithMedia, ELIGIBLE_TO_REVIEW } from './support/touch-p4-mocks';

/**
 * W40A: Cá nhân, Điểm Xanh, Mã giảm giá, Sổ địa chỉ, Đánh giá sản phẩm và Cộng tác viên của Mini App ở 320 / 360 / 375px.
 *  - Mọi điều khiển có vùng chạm thật ≥ 44 × 44px (cả trong tấm sửa địa chỉ, tấm chọn Tỉnh/Phường và tấm viết đánh giá).
 *  - Không tràn ngang; số điểm, tiền, số đếm vẽ bằng số đều (tabular-nums).
 * Phản hồi khi nhấn giữ nằm ở touch-press-p4.miniapp.spec.ts (Chromium). API mock toàn bộ.
 */
async function expectClean(page: Page, screen: string, width: number, scope?: string): Promise<void> {
  const taps = await probeTapTargets(page, { scope });
  expect.soft(taps, `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
  const f = await probeLayout(page, { scope });
  expect.soft(f.overflow, `${screen} ${width}px tràn ngang`).toEqual([]);
  expect.soft(f.notTabular, `${screen} ${width}px số không đều`).toEqual([]);
}

const REVIEWS = '[aria-label="Đánh giá sản phẩm"]';

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: vùng chạm, tràn ngang, số đều (Cá nhân, Điểm Xanh, Mã, Địa chỉ, Đánh giá, CTV)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
    });

    test('Cá nhân', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'u-p4', fullName: 'Nguyễn Văn An', pointsBalance: 12_450, walletBalance: 1_250_000 }));
      api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 12_450, pointsConvertedBalance: 0 });
      api.get('/me/wallet', { walletBalance: 1_250_000 });
      api.get('/me/coupons', [{ id: 'c1', code: 'A' }, { id: 'c2', code: 'B' }]);
      api.get('/me/summary', { orders: { pending_payment: 2, processing: 1, shipping: 0, delivered: 5, closed: 0, active: 3 }, unreadNotifications: 7, activeSubscriptions: 0 });
      api.get('/me/notifications', []);
      api.allowUnmocked('GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary');
      await page.goto('/profile');
      await expect(page.getByText('Nguyễn Văn An').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('12.450 điểm', { exact: true })).toBeVisible();
      await expectClean(page, 'Cá nhân', width);
    });

    test('Điểm Xanh', async ({ page, api }) => {
      mockLoyaltyScreen(api);
      await page.goto('/loyalty');
      await expect(page.getByText('Lộc Biếc').first()).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Điểm Xanh', width);

      await page.getByRole('button', { name: /Thẻ thành viên số/ }).click();
      await expect(page.getByRole('button', { name: /^Chép$/ })).toBeVisible();
      await expectClean(page, 'Thẻ thành viên số', width);
    });

    test('Mã giảm giá: Nhận mã, Mã của tôi, Đã dùng–hết hạn', async ({ page, api }) => {
      mockDiscovery(api, { returning: true });
      mockHomeEngagement(api);
      mockCollectable(api);
      mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
      mockWallet(api, WALLET);
      mockCouponHistory(api);
      for (const [tab, name, ready] of [
        ['', 'Nhận mã', 'button:has-text("Lưu mã")'],
        ['?tab=mine', 'Mã của tôi', '[role="group"]'],
        ['?tab=history', 'Đã dùng–hết hạn', '[role="group"]'],
      ] as const) {
        await page.goto(`/vouchers${tab}`);
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
        await expectClean(page, `Mã giảm giá (${name})`, width);
      }
    });

    test('Sổ địa chỉ, tấm sửa địa chỉ và tấm chọn Tỉnh/Phường', async ({ page, api }) => {
      mockAddressBook(api);
      await page.goto('/addresses');
      await expect(page.getByText('Mặc định', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Sổ địa chỉ', width);

      await page.getByRole('button', { name: 'Sửa' }).first().click();
      const province = page.getByRole('button', { name: /^Tỉnh\/Thành phố:/ });
      await expect(province).toBeVisible();
      await expectClean(page, 'Tấm sửa địa chỉ', width);

      await province.click();
      await expect(page.getByRole('option').first()).toBeVisible();
      await expectClean(page, 'Tấm chọn Tỉnh/Thành phố', width);
    });

    test('Đánh giá sản phẩm có ảnh/video và tấm viết đánh giá', async ({ page, api }) => {
      mockPilotProduct(api);
      mockReviewsWithMedia(api);
      api.get('/products/:slug/reviews/can-review', ELIGIBLE_TO_REVIEW);
      await page.goto(`/product/${PILOT_SLUG}`);
      const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
      await reviews.scrollIntoViewIfNeeded();
      await expect(reviews.getByText('Nhận xét r1')).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Đánh giá', width, REVIEWS);

      await expect.poll(() => api.callsTo('GET', '/products/:slug/reviews/can-review').length, { timeout: 15_000 }).toBeGreaterThan(0);
      await reviews.getByRole('button', { name: 'Viết đánh giá' }).click({ timeout: 15_000 });
      await expect(page.getByRole('radiogroup', { name: 'Số sao' })).toBeVisible();
      await expectClean(page, 'Tấm viết đánh giá', width);
    });

    test('Cộng tác viên', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
      mockAffiliateDashboard(api, { milestones: CTV_MILESTONES });
      api.allowUnmocked('POST /events');
      for (const [tab, name, ready] of [
        ['overview', 'Tổng quan', 'CTV Đồng'],
        ['commission', 'Hoa hồng', 'Hoa hồng'],
        ['share', 'Chia sẻ', 'Mã giới thiệu của bạn'],
      ] as const) {
        await page.goto(`/affiliate?tab=${tab}`);
        await expect(page.getByText(ready, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
        await expectClean(page, `Cộng tác viên (${name})`, width);
      }
    });
  });
}
