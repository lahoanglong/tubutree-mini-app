import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { CATALOG, checkInStatus } from './support/discovery-mocks';
import { COLLECTABLE, mockCollectable, mockWallet } from './support/voucher-mocks';
import { hubPanel, hubTab, mockLoyaltyPreview, pathAndSearch } from './support/offers-mocks';

/**
 * Web khách, Ưu đãi (/uu-dai) và Mã giảm giá (/ma-giam-gia): Ưu đãi là MỘT trang, ba tab đổi tại chỗ bằng ?tab= (replace): Săn mã (mặc định), Mã của tôi, Đổi quà.
 * Khách chưa đăng nhập xem được Giờ vàng và Nhận mã, "Lưu mã" chuyển tới đăng nhập kèm đường quay lại và KHÔNG gọi /coupons/claim; cả hai trang noindex.
 * Mọi lời gọi /api/** đi qua mock. Host phải là localhost (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng. Cần API thật khởi chạy cùng web
 * nên chạy ở CI (e2e.yml), không chạy trong máy dev đang thiếu RAM.
 */

const HOUR = 3_600_000;

const STRIP_TODO = 'Hôm nay bạn chưa điểm danh';
const anyStrip = (page: Page) => page.getByRole('region', { name: /^Hôm nay bạn (chưa|đã) điểm danh$/ });

function mockFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

test.describe('Web khách: Ưu đãi, chưa đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockFlash(api);
    mockCollectable(api);
  });

  test('/uu-dai: tab Săn mã thấy Giờ vàng và Nhận mã; Lưu mã chuyển tới đăng nhập kèm returnTo, không gọi claim', async ({ page, api }) => {
    await page.goto('/uu-dai');
    await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible();
    const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
    await expect(collect).toBeVisible();
    await expect(collect.getByRole('button', { name: 'Lưu mã' })).toHaveCount(COLLECTABLE.length);
    // Phần cần tài khoản không dựng cho khách trên tab này: MỘT thẻ mời "Đăng nhập" thay dải Điểm Xanh + điểm danh. Ví mã và Kho quà nằm ở hai tab kia, thẻ điểm danh đầy đủ không còn.
    await expect(page.getByRole('region', { name: 'Điểm Xanh và điểm danh', exact: true }).getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveAttribute('href', /\/dang-nhap\?returnTo=%2Fuu-dai/);
    await expect(hubPanel(page, 'Săn mã').getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Đổi quà', exact: true })).toHaveCount(0);
    await expect(anyStrip(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Điểm danh mỗi ngày' })).toHaveCount(0);
    await collect.getByRole('button', { name: 'Lưu mã' }).first().click();
    await expect(page).toHaveURL(/\/dang-nhap\?returnTo=%2Fuu-dai/);
    expect(api.callsTo('POST', '/coupons/claim')).toHaveLength(0);
  });

  test('/uu-dai?tab=wallet: tab Mã của tôi chỉ có thẻ mời "Đăng nhập" (không Giờ vàng, Nhận mã), không gọi /me/coupons', async ({ page, api }) => {
    await page.goto('/uu-dai?tab=wallet');
    await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true }).getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveAttribute('href', /\/dang-nhap\?returnTo=%2Fuu-dai/);
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toHaveCount(0);
    expect(api.callsTo('GET', '/me/coupons')).toHaveLength(0);
  });

  test('/uu-dai?tab=rewards: tab Đổi quà khách vẫn xem Kho quà, không có thẻ Điểm Xanh (cần tài khoản)', async ({ page, api }) => {
    mockLoyaltyPreview(api);
    await page.goto('/uu-dai?tab=rewards');
    await expect(hubTab(page, 'Đổi quà')).toHaveAttribute('aria-selected', 'true');
    await expect(hubPanel(page, 'Đổi quà').getByText('Miễn phí vận chuyển').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Điểm Xanh của bạn', exact: true })).toHaveCount(0);
    await expect(page.getByText('Hạng và lịch sử điểm')).toHaveCount(0);
  });

  test('bấm tab: URL đổi đúng ?tab=, KHÔNG thêm mục lịch sử; Back rời trang Ưu đãi chứ không tua từng tab', async ({ page }) => {
    // Mở Mã giảm giá rồi mở Ưu đãi bằng tải trang (mục lịch sử thật): Back phải về Mã giảm giá dù đã bấm cả ba tab.
    await page.goto('/ma-giam-gia');
    await expect(page.getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/uu-dai');
    await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true');
    const length = await page.evaluate(() => window.history.length);

    await hubTab(page, 'Mã của tôi').click();
    await expect.poll(() => pathAndSearch(page)).toBe('/uu-dai?tab=wallet');
    await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
    await expect(hubPanel(page, 'Mã của tôi')).toBeVisible();

    await hubTab(page, 'Đổi quà').click();
    await expect.poll(() => pathAndSearch(page)).toBe('/uu-dai?tab=rewards');
    await expect(hubTab(page, 'Đổi quà')).toHaveAttribute('aria-selected', 'true');
    await expect(hubPanel(page, 'Đổi quà')).toBeVisible();

    // Tab mặc định không kèm tham số để link chia sẻ gọn.
    await hubTab(page, 'Săn mã').click();
    await expect.poll(() => pathAndSearch(page)).toBe('/uu-dai');
    await expect(hubPanel(page, 'Săn mã')).toBeVisible();

    expect(await page.evaluate(() => window.history.length), 'đổi tab đã thêm mục lịch sử').toBe(length);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/ma-giam-gia');
  });

  test('link cũ ?section=coupons mở thẳng tab Mã của tôi (giữ nguyên URL)', async ({ page }) => {
    await page.goto('/uu-dai?section=coupons');
    await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
    await expect(hubPanel(page, 'Mã của tôi')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
    expect(pathAndSearch(page)).toBe('/uu-dai?section=coupons');
  });

  test('/uu-dai và /ma-giam-gia noindex', async ({ page }) => {
    for (const path of ['/uu-dai', '/ma-giam-gia']) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
  });

  test('/ma-giam-gia: Nhận mã xem được; Mã của tôi mời đăng nhập, không gọi /me/coupons', async ({ page, api }) => {
    await page.goto('/ma-giam-gia');
    await expect(page.getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('voucher-grid').getByRole('button', { name: 'Lưu mã' })).toHaveCount(COLLECTABLE.length);
    await page.getByRole('tab', { name: 'Mã của tôi' }).click();
    await expect(page).toHaveURL(/tab=mine/);
    await expect(page.getByRole('link', { name: 'Đăng nhập với Zalo' })).toHaveAttribute('href', /\/dang-nhap\?returnTo=.*ma-giam-gia.*tab%3Dmine/);
    expect(api.callsTo('GET', '/me/coupons')).toHaveLength(0);
  });
});

test.describe('Web khách: Ưu đãi, đã đăng nhập', () => {
  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy
      }
    });
    api.post('/auth/refresh', () => ({
      accessToken: 'e2e-token',
      user: { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0 },
    }));
    mockFlash(api);
    mockCollectable(api);
    mockWallet(api);
    api.get('/me/daily-check-in', checkInStatus(false));
  });

  test('link cũ ?section=coupons mở tab Mã của tôi với CẢ ví: mỗi phiếu có "Dùng ngay", không còn Giờ vàng', async ({ page }) => {
    await page.goto('/uu-dai?section=coupons');
    await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
    const mine = page.getByRole('region', { name: 'Mã của tôi', exact: true });
    await expect(mine.getByRole('group')).toHaveCount(2);
    await expect(mine.getByRole('button', { name: 'Dùng ngay' })).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
    expect(pathAndSearch(page)).toBe('/uu-dai?section=coupons');
  });

  test('bấm dải điểm danh mở tab Vườn Xanh (/vuon-xanh) bằng replace, không gọi POST điểm danh', async ({ page, api }) => {
    api.get('/game/profile', {
      totalSeeds: 340, streakDays: 5, treeStage: 2, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: null,
      ecoImpact: { progress: 40, target: 100, treeType: 'Cây Sưa Đỏ', treesPlanted: 3 }, treePointsPrice: 300, spinCostPoints: 10,
    });
    api.get('/game/quiz/today', []);
    api.get('/game/missions', []);
    api.allowUnmocked('POST /events');
    await page.goto('/uu-dai');
    const strip = page.getByRole('region', { name: STRIP_TODO, exact: true });
    await expect(strip).toBeVisible();
    await expect(anyStrip(page)).toHaveCount(1);
    await expect(strip.getByText('Mở tab Vườn Xanh')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Điểm danh', exact: true })).toHaveCount(0);
    const length = await page.evaluate(() => window.history.length);
    await strip.getByRole('button').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/vuon-xanh');
    expect(await page.evaluate(() => window.history.length), 'sang tab gốc kế bên phải thay mục hiện tại, không thêm mục lịch sử').toBe(length);
    expect(api.callsTo('POST', '/me/daily-check-in')).toHaveLength(0);
  });
});
