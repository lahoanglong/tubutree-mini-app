import { test, expect } from '@playwright/test';

test.describe('Zalo Mini App - Tính năng mới (Brand Owner & Storefront)', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
  });

  test('Gian hàng Nhãn hàng (Brand Owner Flow)', async ({ page }) => {
    // 1. Mock Auth
    await page.route('**/api/auth/guest', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          accessToken: 'mock-brand-token',
          refreshToken: 'mock-refresh',
          // walletBalance/pointsBalance/coinsBalance/referralCode bắt buộc (AuthUser, shared-types) —
          // thiếu walletBalance làm ProfilePage crash ở formatVnd(user.walletBalance).toLocaleString().
          user: {
            id: 'brand-1', role: 'ADMIN', fullName: 'Brand Owner 1',
            referralCode: 'BRAND1', pointsBalance: 0, walletBalance: 0, coinsBalance: 0,
          },
        }),
      });
    });

    // 2. Mock Owned Brand
    await page.route('**/api/brand/owner/me', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          id: 'brand-123',
          slug: 'tubu-brand',
          name: 'Tubu Official',
          logoUrl: null,
          coverUrl: null,
          tagline: 'Sống Xanh An Lành',
          story: 'Câu chuyện thương hiệu...',
          isVerified: true,
          isPublished: true,
          followerCount: 150,
          promotions: []
        }),
      });
    });

    // 3. Mock Loyalty/Notifs to avoid Profile page errors
    await page.route('**/api/account/loyalty', async (r) => r.fulfill({ json: { pointsBalance: 100 } }));
    await page.route('**/api/account/notifications', async (r) => r.fulfill({ json: [] }));

    await page.goto('/profile');

    // Đợi menu "Quản lý nhãn hàng" xuất hiện và bấm.
    // Timeout 10s (không phải mặc định 5s): restore() thử Zalo SDK bridge (login/getAccessToken,
    // tối đa ~3s timeout riêng) trước khi rơi xuống guest login mock — xem miniapp.spec.ts.
    await expect(page.locator('text=Quản lý nhãn hàng')).toBeVisible({ timeout: 10000 });
    await page.click('text=Quản lý nhãn hàng');

    // Chuyển sang màn Quản lý nhãn hàng, xác nhận load thành công.
    // .first(): trang /profile trước đó vẫn còn "Tubu Official" (hint menu) ẩn trong DOM
    // trong lúc chuyển màn (AnimationRoutes của zmp-ui) → "Tubu Official" khớp 2 phần tử.
    await expect(page).toHaveURL(/\/brand-owner/);
    await expect(page.locator('text=Tubu Official').first()).toBeVisible();
    
    await page.screenshot({ path: 'brand-owner-view.png' });
  });

  test('Gian hàng Cộng tác viên (Storefront Builder Flow)', async ({ page }) => {
    await page.route('**/api/auth/guest', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          accessToken: 'mock-aff-token',
          refreshToken: 'mock-refresh',
          user: {
            id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1',
            referralCode: 'AFF1', pointsBalance: 0, walletBalance: 0, coinsBalance: 0,
          },
        }),
      });
    });

    // Mock Storefront — khớp shape StorefrontEdit thật (services/storefront-api.ts):
    // { id, slug, type, title, headerNote, avatarUrl, coverUrl, theme, isPublished, collections }.
    await page.route('**/api/storefront/me', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
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
        }),
      });
    });
    await page.route('**/api/storefront/me/quests', async (r) =>
      r.fulfill({ json: { quests: [], totalEarnedXu: 0, level: 0, levelMax: 5 } }),
    );

    await page.route('**/api/account/loyalty', async (r) => r.fulfill({ json: { pointsBalance: 0 } }));
    await page.route('**/api/account/notifications', async (r) => r.fulfill({ json: [] }));
    await page.route('**/api/brand/owner/me', async (r) => r.fulfill({ status: 404 }));

    // Mock các query của AffiliatePage/Dashboard (apps/miniapp/src/pages/affiliate.tsx) —
    // isAffiliate:true để vào Dashboard thay vì RegisterGate.
    await page.route('**/api/affiliate/me', async (r) =>
      r.fulfill({ json: { isAffiliate: true, referralCode: 'CTV-AFF1', walletBalance: 0 } }),
    );
    await page.route('**/api/affiliate/dashboard', async (r) =>
      r.fulfill({
        json: {
          todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0,
          totalClicks: 0, totalConversions: 0, monthRevenue: 0,
          tier: { name: 'Đồng', emoji: '🥉', bonusPct: 0, nextName: null, nextThreshold: null, toNext: 0 },
        },
      }),
    );
    await page.route('**/api/affiliate/links', async (r) => r.fulfill({ json: [] }));
    await page.route('**/api/affiliate/commissions', async (r) => r.fulfill({ json: [] }));
    await page.route('**/api/affiliate/analytics/storefronts', async (r) => r.fulfill({ json: { storefronts: [] } }));
    await page.route('**/api/affiliate/analytics/products', async (r) => r.fulfill({ json: [] }));

    await page.goto('/profile');

    // Đợi menu "Cộng tác viên" xuất hiện và bấm (timeout 10s — xem giải thích ở test trên).
    await expect(page.locator('text=Cộng tác viên')).toBeVisible({ timeout: 10000 });
    await page.click('text=Cộng tác viên');

    // Nút "🏪 Gian hàng của tôi" trong Dashboard Affiliate (affiliate.tsx:254-256)
    await expect(page.locator('text=Gian hàng của tôi')).toBeVisible();
    await page.click('text=Gian hàng của tôi');

    // Chuyển sang màn Storefront Builder
    await expect(page).toHaveURL(/\/storefront/);
    await expect(page.locator('text=Cửa hàng Xanh của Affiliate 1')).toBeVisible();

    await page.screenshot({ path: 'storefront-builder-view.png' });
  });
});
