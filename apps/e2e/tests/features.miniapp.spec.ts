import type { LoyaltyOverview } from '../../miniapp/src/services/account-api';
import type { OwnedBrand } from '../../miniapp/src/services/brand-owner-api';
import type { DealerMe } from '../../miniapp/src/services/dealer-api';
import type { QuestList, StorefrontEdit, StorefrontStats } from '../../miniapp/src/services/storefront-api';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
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

const NOT_DEALER: DealerMe = { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 };

function mockProfile(api: MockApi): void {
  api.get('/me/loyalty', LOYALTY);
  api.get('/me/notifications', []);
  api.get('/dealer/me', NOT_DEALER);
}

test.describe('Zalo Mini App - Tính năng mới (Brand Owner & Storefront)', () => {
  test('Gian hàng Nhãn hàng (Brand Owner Flow)', async ({ page, api }, testInfo) => {
    // walletBalance/pointsBalance/coinsBalance/referralCode bắt buộc (AuthUser, shared-types) —
    // thiếu walletBalance làm ProfilePage crash ở formatVnd(user.walletBalance).
    mockSession(api, makeUser({ id: 'brand-1', role: 'ADMIN', fullName: 'Brand Owner 1', referralCode: 'BRAND1' }));
    mockProfile(api);

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
    await expect(page.getByText('Quản lý nhãn hàng')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Quản lý nhãn hàng').click();

    // .first(): trang /profile trước đó vẫn còn "Tubu Official" (hint menu) trong DOM lúc chuyển
    // màn (AnimationRoutes của zmp-ui).
    await expect(page).toHaveURL(/\/brand-owner/);
    await expect(page.getByText('Tubu Official').first()).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('brand-owner-view.png') });
  });

  test('Gian hàng Cộng tác viên (Storefront Builder Flow)', async ({ page, api }, testInfo) => {
    mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
    mockProfile(api);
    // Không sở hữu nhãn → 404 (brand.controller owner/me) → menu không có "Quản lý nhãn hàng".
    api.get('/brand/owner/me', reply(404, { message: 'Bạn chưa sở hữu nhãn hàng nào' }));
    // Dashboard CTV (isAffiliate:true để vào Dashboard thay vì RegisterGate) + /affiliate/tiers +
    // /affiliate/milestones (WIP bậc CTV & thưởng mốc).
    mockAffiliateDashboard(api);

    const storefront: StorefrontEdit = {
      id: 'sf-1',
      slug: 'shop-aff-1',
      type: 'CTV',
      title: 'Cửa hàng Xanh của Affiliate 1',
      headerNote: 'Mua hàng ủng hộ mình nhé',
      avatarUrl: null,
      coverUrl: null,
      theme: 'default',
      isPublished: false,
      collections: [],
    };
    const quests: QuestList = { quests: [], totalEarnedXu: 0, level: 0, levelMax: 5 };
    api.get('/storefront/me', storefront);
    api.get('/storefront/me/quests', quests);
    api.get('/storefront/me/products', []);
    const stats: StorefrontStats = { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] };
    api.get('/storefront/me/stats', stats);

    await page.goto('/profile');

    await expect(page.getByText('Cộng tác viên', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Cộng tác viên', { exact: true }).click();

    // Dashboard CTV: bậc theo doanh số đã chốt (không còn "+X% bonus").
    await expect(page.getByText('CTV Đồng')).toBeVisible();
    await expect(page.getByText(/bonus/i)).toHaveCount(0);

    // Nút "Gian hàng của tôi" trong Dashboard Affiliate
    await expect(page.getByText('Gian hàng của tôi')).toBeVisible();
    await page.getByText('Gian hàng của tôi').click();

    await expect(page).toHaveURL(/\/storefront/);
    await expect(page.getByText('Cửa hàng Xanh của Affiliate 1').first()).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('storefront-builder-view.png') });
  });
});
