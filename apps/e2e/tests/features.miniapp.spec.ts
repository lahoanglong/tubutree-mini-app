import type { LoyaltyOverview, WalletSummary } from '../../miniapp/src/services/account-api';
import type { OwnedBrand } from '../../miniapp/src/services/brand-owner-api';
import type { DealerMe } from '../../miniapp/src/services/dealer-api';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockAffiliateDashboard } from './support/affiliate-mocks';

/**
 * Zalo Mini App — Tính năng Brand Owner & Storefront, đi từ /profile (apps/miniapp/src/pages/profile.tsx).
 * Profile gọi: GET /me/loyalty, /me/notifications, /brand/owner/me, /dealer/me (route NestJS:
 * loyalty.controller.ts, notifications.controller.ts, brand.controller.ts, dealer.controller.ts).
 */

const LOYALTY: LoyaltyOverview = {
  pointsBalance: 100,
  tierPoints: 100,
  tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: [] },
  nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 400 },
  tiers: [
    { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
    { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
  ],
};

const WALLET: WalletSummary = {
  walletBalance: 0,
  cashbackPending: 0,
  commissionApproved: 0,
  commissionPending: 0,
};

const NOT_DEALER: DealerMe = { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 };

function mockProfile(api: MockApi): void {
  api.get('/me/loyalty', LOYALTY);
  api.get('/me/notifications', []);
  // Thanh số dư của hub Cá nhân (C-086) đọc ví và mã giảm giá.
  api.get('/me/wallet', WALLET);
  api.get('/me/coupons', []);
  api.get('/dealer/me', NOT_DEALER);
}

test.describe('Zalo Mini App - Tính năng mới (Brand Owner & Storefront)', () => {
  test('Gian hàng Nhãn hàng (Brand Owner Flow)', async ({ page, api }, testInfo) => {
    // walletBalance/pointsBalance/pointsConvertedBalance/referralCode bắt buộc (AuthUser, shared-types) —
    // thiếu walletBalance làm ProfilePage crash ở formatVnd(user.walletBalance).
    mockSession(api, makeUser({ id: 'brand-1', role: 'ADMIN', fullName: 'Brand Owner 1', referralCode: 'BRAND1' }));
    mockProfile(api);
    api.get('/affiliate/me', { isAffiliate: true, canRegister: false, canOpenStorefront: true });
    api.get('/auth/me', { ownsBrand: true });

    const brand: OwnedBrand = {
      id: 'brand-123',
      slug: 'tubu-brand',
      name: 'Tubu Official',
      logoUrl: null,
      coverUrl: null,
      tagline: 'Sống Xanh An Lành',
      story: 'Câu chuyện thương hiệu...',
      origin: null,
      isVerified: true,
      isPublished: true,
      followerCount: 150,
      promotions: [],
    };
    api.get('/brand/owner/me', brand);

    await page.goto('/profile');

    // Timeout 15s: restore() thử Zalo SDK bridge (login/getAccessToken, tối đa ~3s timeout riêng)
    // trước khi rơi xuống guest login mock.
    await expect(page.getByText('Quản lý thương hiệu')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Quản lý thương hiệu').click();

    // Màn quản lý thương hiệu làm đầy đủ trên web (W177): Mini App giữ đường dẫn và hiện thẻ chuyển sang website.
    await expect(page).toHaveURL(/\/brand-owner/);
    await expect(page.getByRole('heading', { level: 1, name: 'Quản lý thương hiệu' })).toBeVisible();
    await expect(page.getByText('https://tubutree.com/chu-thuong-hieu')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('brand-owner-view.png') });
  });

  test('Gian hàng Cộng tác viên (Storefront Builder Flow)', async ({ page, api }, testInfo) => {
    mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
    mockProfile(api);
    api.get('/auth/me', { ownsBrand: false });
    // ownsBrand false → hub không hỏi /brand/owner/me (không mock ở đây: lời gọi sẽ làm fixture báo đỏ).
    // Dashboard CTV (isAffiliate:true để vào Dashboard thay vì RegisterGate) + /affiliate/tiers +
    // /affiliate/milestones (WIP bậc CTV & thưởng mốc).
    mockAffiliateDashboard(api);

    await page.goto('/profile');

    await expect(page.getByText('Cộng tác viên', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Quản lý thương hiệu')).toHaveCount(0);
    expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);
    expect(api.callsTo('GET', '/brand/owner/me')).toHaveLength(0);
    await page.getByText('Cộng tác viên', { exact: true }).click();

    // Dashboard CTV: bậc theo doanh số đã chốt (không còn "+X% bonus").
    await expect(page.getByTestId('ctv-hero-tier').getByText('CTV Đồng')).toBeVisible();
    await expect(page.getByText('CTV Đồng', { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/bonus/i)).toHaveCount(0);

    // Lối tắt "Gian hàng" (tên đọc đầy đủ "Gian hàng của tôi") ngay dưới thẻ hoa hồng của Dashboard Affiliate
    const storefrontShortcut = page.getByRole('button', { name: 'Gian hàng của tôi' });
    await expect(storefrontShortcut).toBeVisible();
    await storefrontShortcut.click();

    // Dựng gian hàng làm đầy đủ trên web (W177): Mini App giữ đường dẫn và hiện thẻ chuyển sang website.
    await expect(page).toHaveURL(/\/storefront/);
    await expect(page.getByRole('heading', { level: 1, name: 'Gian hàng của tôi' })).toBeVisible();
    await expect(page.getByText('https://tubutree.com/ctv/gian-hang')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('storefront-builder-view.png') });
  });
});
